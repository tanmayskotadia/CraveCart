import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { ZodError } from 'zod';
import { HttpError, upstream, type DomainContext } from './security.js';
import { IdempotencyConflict } from '@cravecart/persistence';
export * from './security.js';
import { loadConfig, type Config } from '@cravecart/config';
import {
  emptyQuerySchema,
  platformSchema,
  nationalMarket,
  isRequestId,
  serviceNames,
  type ServiceName,
} from '@cravecart/contracts';
import {
  createLogger,
  startTelemetry,
  context,
  propagation,
  trace,
  SpanStatusCode,
  randomUUID,
  downstreamHeaders,
} from '@cravecart/observability';
import {
  MongoClient,
  RabbitBroker,
  ensurePersistence,
  dispatchOutbox,
  consumeOnce,
} from '@cravecart/persistence';

export type RuntimeName = ServiceName | 'gateway';
export const ports: Record<RuntimeName, number> = {
  gateway: 4000,
  auth: 4001,
  restaurant: 4002,
  rider: 4003,
  admin: 4004,
  realtime: 4005,
  utils: 4006,
};
type Checks = Record<string, boolean>;
export interface Resources {
  check(): Promise<Checks>;
  close(): Promise<void>;
}
interface AppOptions {
  name: RuntimeName;
  config: Config;
  resources: Resources;
  fetcher?: typeof fetch;
  configure?: (app: express.Express) => void;
  isDraining?: () => boolean;
  buildIdentity?: string | null;
}
const timeout = async <T>(promise: Promise<T>, ms = 1200): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Dependency timeout')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
function tokenMatches(given: string | undefined, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp({
  name,
  config,
  resources,
  fetcher = fetch,
  configure,
  isDraining = () => false,
  buildIdentity,
}: AppOptions) {
  const app = express();
  if (name === 'gateway' && config.TRUSTED_PROXY_CIDRS)
    app.set(
      'trust proxy',
      config.TRUSTED_PROXY_CIDRS.split(',').map((value) => value.trim()),
    );
  const logger = createLogger(name);
  let requests = 0;
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.APP_ORIGIN, credentials: true }));
  app.use(((req, res, next) => {
    const requestId = isRequestId(req.headers['x-request-id'])
      ? req.headers['x-request-id']
      : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    const parent = propagation.extract(context.active(), req.headers);
    const span = trace
      .getTracer('cravecart-http')
      .startSpan(
        `${name} ${req.method}`,
        { attributes: { 'service.name': name, 'http.request.method': req.method } },
        parent,
      );
    res.locals.traceId = span.spanContext().traceId;
    res.on('finish', () => {
      requests++;
      span.setAttribute('http.response.status_code', res.statusCode);
      if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      logger.info(
        {
          requestId,
          traceId: span.spanContext().traceId,
          statusCode: res.statusCode,
          method: req.method,
        },
        'request completed',
      );
      span.end();
    });
    context.with(trace.setSpan(parent, span), next);
  }) satisfies RequestHandler);
  app.get('/health/live', (_req, res) => res.json({ status: 'up', service: name }));
  app.get('/health/release', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let fingerprint = buildIdentity;
    if (fingerprint === undefined) {
      try {
        fingerprint = JSON.parse(
          readFileSync(new URL('./release.json', import.meta.url), 'utf8'),
        ).buildSha256;
      } catch {
        fingerprint = null;
      }
    }
    const owners: Record<string, boolean> = {};
    const valid = typeof fingerprint === 'string' && /^[a-f0-9]{64}$/.test(fingerprint);
    if (name === 'gateway' && valid) {
      await Promise.all(
        serviceNames.map(async (owner) => {
          try {
            const response = await fetcher(new URL('/health/release', upstream(owner)), {
              signal: AbortSignal.timeout(1500),
              redirect: 'error',
            });
            const value = await response.json();
            owners[owner] =
              response.ok &&
              value.service === owner &&
              value.algorithm === 'cravecart-deployment-v1' &&
              value.buildSha256 === fingerprint;
          } catch {
            owners[owner] = false;
          }
        }),
      );
    }
    const matched =
      valid && (name !== 'gateway' || serviceNames.every((owner) => owners[owner] === true));
    res.status(matched ? 200 : 503).json({
      service: name,
      algorithm: 'cravecart-deployment-v1',
      buildSha256: valid ? fingerprint : null,
      owners,
    });
  });
  app.get('/health/ready', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const checks = isDraining()
      ? { draining: false }
      : await timeout(resources.check(), 2000).catch(() => ({ dependencies: false }));
    const ready = Object.values(checks).every(Boolean) && Object.keys(checks).length > 0;
    res
      .status(ready ? 200 : 503)
      .json({ status: ready ? 'ready' : 'not-ready', service: name, checks });
  });
  app.use('/api', (_req, res, next) => {
    // Includes failures, private media and authenticated GETs at every owner and proxy.
    res.setHeader('Cache-Control', 'private, no-store');
    if (!isDraining()) return next();
    res.setHeader('Retry-After', '5');
    res.status(503).json({
      error: {
        code: 'SERVICE_DRAINING',
        message: 'Service is restarting. Please retry shortly',
        requestId: res.locals.requestId,
        retryable: true,
      },
    });
  });
  app.get('/metrics', (req, res) => {
    if (!tokenMatches(req.headers.authorization, config.METRICS_TOKEN)) {
      res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required',
          requestId: res.locals.requestId,
          retryable: false,
        },
      });
      return;
    }
    res
      .type('text/plain')
      .send(
        `# HELP cravecart_http_requests_total Completed HTTP requests\n# TYPE cravecart_http_requests_total counter\ncravecart_http_requests_total{service="${name}"} ${requests}\n`,
      );
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: config.NODE_ENV === 'production' ? 120 : 1000,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: 'Please try again shortly',
            requestId: res.locals.requestId,
            retryable: true,
          },
        });
      },
    }),
  );
  // Provider webhook routes will register raw-body parsing before JSON parsing when implemented.
  app.use('/api/v1/uploads', express.raw({ type: 'application/octet-stream', limit: '5mb' }));
  app.use('/api/v1/webhooks', express.raw({ type: 'application/json', limit: '256kb' }));
  app.use('/api/v1/cart', express.json({ limit: '128kb' }));
  app.use(express.json({ limit: '32kb' }));
  if (name === 'admin') {
    app.get('/api/v1/platform', (req, res) => {
      emptyQuerySchema.parse(req.query);
      res.setHeader('Cache-Control', 'no-store');
      res.json(
        platformSchema.parse({
          data: {
            name: 'CraveCart',
            market: nationalMarket,
            capabilities: {
              ordering: config.COMMERCE_MODE !== 'disabled',
              authentication:
                config.DEV_ADAPTERS === 'true' ||
                Boolean(config.SMTP_URL && config.SMTP_FROM) ||
                Boolean(
                  config.TWILIO_ACCOUNT_SID &&
                  config.TWILIO_AUTH_TOKEN &&
                  config.TWILIO_FROM_NUMBER,
                ),
              liveTracking: config.COMMERCE_MODE !== 'disabled',
              assistant: true,
            },
            serviceability: 'coordinate-check-required',
          },
          meta: { requestId: res.locals.requestId },
        }),
      );
    });
  }
  if (name === 'gateway') {
    app.get('/api/v1/platform', async (req, res) => {
      emptyQuerySchema.parse(req.query);
      const headers = downstreamHeaders(res.locals.requestId as string);
      headers['x-internal-token'] = config.INTERNAL_TOKEN;
      const response = await fetcher(new URL('/api/v1/platform', upstream('admin')), {
        headers,
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new Error('Upstream unavailable');
      const parsed = platformSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('Upstream contract violation');
      const body = parsed.data;
      if (body.meta.requestId !== res.locals.requestId) throw new Error('Correlation mismatch');
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    });
    app.use('/api/v1', async (req, res, next) => {
      const segment = req.path.split('/')[1];
      const owners: Record<string, ServiceName> = {
        auth: 'auth',
        seller: 'restaurant',
        rider: 'rider',
        admin: 'admin',
        uploads: 'utils',
        media: 'utils',
        addresses: 'auth',
        restaurants: 'restaurant',
        cart: 'restaurant',
        favorites: 'restaurant',
        offers: 'restaurant',
        serviceability: 'admin',
        quotes: 'restaurant',
        orders: 'restaurant',
        payments: 'utils',
        refunds: 'utils',
        webhooks: 'utils',
        realtime: 'realtime',
        notifications: 'realtime',
        support: 'admin',
        reviews: 'restaurant',
        assistant: 'utils',
      };
      const owner = /^\/orders\/[^/]+\/messages(?:\/|$)/.test(req.path)
        ? 'realtime'
        : segment
          ? owners[segment]
          : undefined;
      if (!owner) {
        next();
        return;
      }
      try {
        const { upstream, mac } = await import('./security.js');
        const headers = downstreamHeaders(res.locals.requestId as string);
        for (const key of [
          'cookie',
          'origin',
          'content-type',
          'accept',
          'x-csrf-token',
          'idempotency-key',
          'x-upload-token',
          'stripe-signature',
          'x-razorpay-signature',
          'x-razorpay-event-id',
        ]) {
          const value = req.get(key);
          if (value) headers[key] = value;
        }
        const timestamp = String(Date.now());
        headers['x-cc-client-ip'] = req.ip ?? 'unknown';
        headers['x-cc-ip-time'] = timestamp;
        headers['x-cc-ip-proof'] = mac(
          config.INTERNAL_TOKEN,
          `${owner}:${timestamp}:${headers['x-cc-client-ip']}`,
        );
        const body =
          req.method === 'GET' || req.method === 'HEAD'
            ? undefined
            : Buffer.isBuffer(req.body)
              ? new Uint8Array(req.body).buffer
              : JSON.stringify(req.body ?? {});
        const disconnect = new AbortController();
        res.once('close', () => {
          if (!res.writableEnded) disconnect.abort();
        });
        const response = await fetcher(new URL(req.originalUrl, upstream(owner)), {
          method: req.method,
          headers,
          body,
          signal: AbortSignal.any([
            disconnect.signal,
            AbortSignal.timeout(segment === 'assistant' ? 45000 : 20000),
          ]),
          redirect: 'manual',
        });
        for (const key of ['content-type', 'content-disposition', 'retry-after']) {
          const value = response.headers.get(key);
          if (value) res.setHeader(key, value);
        }
        const setCookies = response.headers.getSetCookie();
        if (setCookies.length) res.setHeader('set-cookie', setCookies);
        res.setHeader('x-content-type-options', 'nosniff');
        if (
          response.headers.get('content-type')?.startsWith('text/event-stream') &&
          response.body
        ) {
          res.status(response.status);
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders();
          await pipeline(
            Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
            res,
          );
          return;
        }
        res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        if (res.destroyed) return;
        if (res.headersSent) {
          res.end();
          return;
        }
        next(error);
      }
    });
  }
  configure?.(app);
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'This endpoint is not available',
        requestId: res.locals.requestId,
        retryable: false,
      },
    });
  });
  app.use(((error, _req, res, _next) => {
    if (error instanceof IdempotencyConflict)
      error = new HttpError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This request key was already used for a different change',
      );
    if (error?.code === 11000)
      error = new HttpError(409, 'RESOURCE_CONFLICT', 'The resource changed. Refresh and retry.');
    const invalid = error instanceof ZodError || error?.type === 'entity.parse.failed';
    const oversized = error?.type === 'entity.too.large';
    const unsupported = ['charset.unsupported', 'encoding.unsupported'].includes(error?.type);
    const known = error instanceof HttpError;
    const status = known ? error.status : oversized ? 413 : unsupported ? 415 : invalid ? 400 : 503;
    // Log classification only; exceptions can contain connection URLs or request bodies.
    logger.warn(
      {
        requestId: res.locals.requestId,
        code: invalid ? 'INVALID_REQUEST' : 'DEPENDENCY_UNAVAILABLE',
      },
      'request rejected',
    );
    res.status(status).json({
      error: {
        code: known
          ? error.code
          : oversized
            ? 'PAYLOAD_TOO_LARGE'
            : unsupported
              ? 'UNSUPPORTED_MEDIA_TYPE'
              : invalid
                ? 'INVALID_REQUEST'
                : 'DEPENDENCY_UNAVAILABLE',
        message: known
          ? error.message
          : oversized
            ? 'Request is too large'
            : unsupported
              ? 'Unsupported request encoding'
              : invalid
                ? 'Check your request and try again'
                : 'Service temporarily unavailable',
        requestId: res.locals.requestId,
        retryable: known ? error.retryable : status === 503,
      },
    });
  }) satisfies ErrorRequestHandler);
  return app;
}

function localResources(
  name: ServiceName,
  config: Config,
  logger: ReturnType<typeof createLogger>,
) {
  const mongo = new MongoClient(config.MONGO_URI, {
    serverSelectionTimeoutMS: 1000,
    connectTimeoutMS: 1000,
  });
  const db = mongo.db(`${config.MONGO_DB_PREFIX}_${name}`);
  const broker = new RabbitBroker(config.RABBITMQ_URL, name);
  const redis = createClient({
    url: config.REDIS_URL,
    socket: { connectTimeout: 1000, reconnectStrategy: false },
  });
  redis.on('error', () => {});
  let initialized = false;
  let running = false;
  let stopped = false;
  let work: Promise<void> | undefined;
  const check = async () => {
    const tasks = [
      timeout(mongo.db('admin').command({ ping: 1 })),
      timeout(broker.ready()),
      timeout(
        (async () => {
          if (!redis.isOpen) await redis.connect();
          await redis.ping();
        })(),
      ),
    ];
    const result = await Promise.allSettled(tasks);
    return Object.fromEntries(
      ['mongo', 'rabbitmq', 'redis'].map((key, i) => [key, result[i]?.status === 'fulfilled']),
    );
  };
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      if (!initialized) {
        await ensurePersistence(db);
        initialized = true;
      }
      const result = await dispatchOutbox(db, broker);
      if (result === 'failed')
        logger.error({ code: 'OUTBOX_RETRY_EXHAUSTED' }, 'Outbox requires operator review');
    } catch {
      /* Dependency availability is exposed by readiness; do not log credential errors. */
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    // Preserve the in-flight promise until completion; a skipped tick must not replace it.
    if (!running && !stopped) work = tick();
  }, 1000);
  timer.unref();
  return {
    subscribe: (events: string[], handler: Parameters<typeof consumeOnce>[4]) =>
      broker.subscribe(events, async (event) => {
        await consumeOnce(mongo, db, name, event, handler);
      }),
    db,
    client: mongo,
    check,
    async close() {
      stopped = true;
      clearInterval(timer);
      await work;
      await broker.close();
      if (redis.isOpen) await redis.close().catch(() => {});
      await mongo.close();
    },
  } satisfies Resources & Pick<DomainContext, 'db' | 'client' | 'subscribe'>;
}

export async function startService(
  name: RuntimeName,
  install?: (app: express.Express, ctx: DomainContext) => void,
) {
  const config = loadConfig({
    ...process.env,
    SERVICE_NAME: name,
    PORT: process.env.PORT ?? String(ports[name]),
  });
  const shutdownTelemetry = startTelemetry(name);
  const logger = createLogger(name);
  const resources =
    name === 'gateway'
      ? {
          async check() {
            const result = await Promise.all(
              serviceNames.map(async (service) => {
                try {
                  const { upstream } = await import('./security.js');
                  const url = upstream(service);
                  return [
                    service,
                    (
                      await fetch(new URL('/health/ready', url), {
                        signal: AbortSignal.timeout(1500),
                      })
                    ).ok,
                  ] as const;
                } catch {
                  return [service, false] as const;
                }
              }),
            );
            return Object.fromEntries(result);
          },
          async close() {},
        }
      : localResources(name, config, logger);
  const closers: Array<() => Promise<void>> = [];
  let closing = false;
  const socketSetups: Array<(server: Server) => void> = [];
  const server = createServer(
    createApp({
      name,
      config,
      resources,
      isDraining: () => closing,
      configure:
        install && 'db' in resources
          ? (app) =>
              install(app, {
                config,
                db: resources.db,
                client: resources.client,
                subscribe: resources.subscribe,
                onSocket: (setup) => socketSetups.push(setup),
                onClose: (fn) => closers.push(fn),
              })
          : undefined,
    }),
  );
  let io: Server | undefined;
  if (name === 'realtime') {
    io = new Server(server, {
      cors: { origin: config.APP_ORIGIN, credentials: true },
      maxHttpBufferSize: 32_768,
    });
    if (socketSetups.length) for (const setup of socketSetups) setup(io);
    else io.use((_socket, next) => next(new Error('Realtime is unavailable')));
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.PORT, config.HOST, resolve);
  });
  logger.info({ port: config.PORT, host: config.HOST }, 'service listening');
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    const force = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 10_000);
    force.unref();
    io?.disconnectSockets(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const close of closers) await close();
    await resources.close();
    await shutdownTelemetry();
    clearTimeout(force);
  };
  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });
}
