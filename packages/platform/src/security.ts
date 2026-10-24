import {
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import type { Request, Response, RequestHandler } from 'express';
import { MongoServerError, type Db, type MongoClient } from 'mongodb';
import type { Config } from '@cravecart/config';
import { principalSchema, type Principal, type ServiceName } from '@cravecart/contracts';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const opaque = () => randomBytes(32).toString('base64url');
export const mac = (secret: string, value: string) =>
  createHmac('sha256', secret).update(value).digest('hex');
export function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function checkedId(value: unknown) {
  if (typeof value !== 'string' || !uuidPattern.test(value))
    throw new HttpError(400, 'INVALID_ID', 'Invalid resource identifier');
  return value;
}
export interface DomainContext {
  config: Config;
  db: Db;
  client: MongoClient;
  fetcher?: typeof fetch;
  onClose?: (fn: () => Promise<void>) => void;
}
const defaults = {
  auth: 4001,
  restaurant: 4002,
  rider: 4003,
  admin: 4004,
  realtime: 4005,
  utils: 4006,
};
export function upstream(service: ServiceName) {
  return process.env[`${service.toUpperCase()}_URL`] ?? `http://127.0.0.1:${defaults[service]}`;
}
export function cookieNames(config: Config) {
  return config.NODE_ENV === 'production'
    ? { access: '__Host-cc-access', refresh: '__Host-cc-refresh' }
    : { access: 'cc_access', refresh: 'cc_refresh' };
}
export function cookies(req: Request) {
  const result: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    try {
      result[key] = decodeURIComponent(part.slice(index + 1));
    } catch {
      /* Invalid cookies cannot authenticate. */
    }
  }
  return result;
}
export function requireOrigin(req: Request, config: Config) {
  let allowed = req.headers.origin === config.APP_ORIGIN;
  if (!allowed && config.NODE_ENV !== 'production' && req.headers.origin) {
    try {
      const expected = new URL(config.APP_ORIGIN),
        actual = new URL(req.headers.origin);
      allowed =
        ['localhost', '127.0.0.1'].includes(expected.hostname) &&
        ['localhost', '127.0.0.1'].includes(actual.hostname) &&
        expected.protocol === 'http:' &&
        actual.protocol === expected.protocol &&
        actual.port === expected.port;
    } catch {
      /* Malformed origins are never trusted. */
    }
  }
  if (!allowed) throw new HttpError(403, 'ORIGIN_DENIED', 'This request origin is not allowed');
}
export function csrfToken(config: Config, sessionId: string) {
  return mac(config.AUTH_SECRET, `csrf:${sessionId}`);
}
export function requireCsrf(req: Request, config: Config, sessionId: string) {
  requireOrigin(req, config);
  const supplied = req.get('x-csrf-token') ?? '';
  if (!equal(supplied, csrfToken(config, sessionId)))
    throw new HttpError(403, 'CSRF_DENIED', 'Refresh this page before trying again');
}
export function seal(bytes: Buffer, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
  return Buffer.concat([iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
}
export function unseal(bytes: Buffer, secret: string) {
  if (bytes.length < 28) throw new Error('Invalid encrypted record');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    createHash('sha256').update(secret).digest(),
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]);
}
export function currentPrincipal(res: Response) {
  return res.locals.principal as Principal;
}
export function requirePermission(principal: Principal, permission: string, stepUp = false) {
  if (!principal.roles.includes('admin') || !principal.permissions.includes(permission))
    throw new HttpError(403, 'FORBIDDEN', 'You do not have permission for this action');
  if (!principal.mfaEnabled || !principal.mfaVerifiedAt)
    throw new HttpError(403, 'MFA_REQUIRED', 'Team access requires authenticator verification');
  if (
    stepUp &&
    (!principal.mfaVerifiedAt || Date.now() - Date.parse(principal.mfaVerifiedAt) > 5 * 60_000)
  )
    throw new HttpError(403, 'MFA_REQUIRED', 'Verify your authenticator before continuing');
}
export async function internalCall<T>(
  ctx: DomainContext,
  target: ServiceName,
  path: string,
  body: unknown,
): Promise<T> {
  const timestamp = String(Date.now());
  const nonce = opaque();
  const serialized = JSON.stringify(body);
  const sender = ctx.config.SERVICE_NAME;
  const signature = mac(
    ctx.config.INTERNAL_TOKEN,
    [sender, target, 'POST', path, timestamp, nonce, hash(serialized)].join('\n'),
  );
  const response = await (ctx.fetcher ?? fetch)(new URL(path, upstream(target)), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cc-service': sender,
      'x-cc-time': timestamp,
      'x-cc-nonce': nonce,
      'x-cc-signature': signature,
    },
    body: serialized,
    signal: AbortSignal.timeout(15_000),
  });
  const value = (await response.json()) as { data?: T; error?: { code: string; message: string } };
  if (!response.ok)
    throw new HttpError(
      response.status,
      value.error?.code ?? 'DEPENDENCY_UNAVAILABLE',
      value.error?.message ?? 'A required service is temporarily unavailable',
      response.status >= 500,
    );
  return value.data as T;
}
export function internalOnly(ctx: DomainContext, senders: string[]): RequestHandler {
  return async (req, res, next) => {
    try {
      const sender = req.get('x-cc-service') ?? '';
      const timestamp = req.get('x-cc-time') ?? '';
      const nonce = req.get('x-cc-nonce') ?? '';
      const signature = req.get('x-cc-signature') ?? '';
      const expected = mac(
        ctx.config.INTERNAL_TOKEN,
        [
          sender,
          ctx.config.SERVICE_NAME,
          req.method,
          req.originalUrl,
          timestamp,
          nonce,
          hash(JSON.stringify(req.body ?? {})),
        ].join('\n'),
      );
      if (
        !senders.includes(sender) ||
        !/^\d{13}$/.test(timestamp) ||
        Math.abs(Date.now() - Number(timestamp)) > 30_000 ||
        nonce.length < 32 ||
        !equal(signature, expected)
      )
        throw new HttpError(403, 'SERVICE_DENIED', 'Service authentication failed');
      try {
        await ctx.db
          .collection<{ _id: string; expiresAt: Date }>('internal_nonces')
          .insertOne({ _id: `${sender}:${nonce}`, expiresAt: new Date(Date.now() + 60_000) });
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000)
          throw new HttpError(403, 'SERVICE_REPLAY', 'Service request was already used');
        throw error;
      }
      res.locals.caller = sender;
      next();
    } catch (error) {
      next(error);
    }
  };
}
export function remoteSession(
  ctx: DomainContext,
  options: { role?: string; permission?: string; stepUp?: boolean; mutation?: boolean } = {},
): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = cookies(req)[cookieNames(ctx.config).access];
      if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue');
      const principal = principalSchema.parse(
        await internalCall(ctx, 'auth', '/internal/v1/sessions/inspect', { accessToken: token }),
      );
      if (options.role && !principal.roles.includes(options.role as Principal['workspace']))
        throw new HttpError(403, 'FORBIDDEN', 'This workspace is not available to your account');
      if (options.permission) requirePermission(principal, options.permission, options.stepUp);
      if (options.mutation) requireCsrf(req, ctx.config, principal.sessionId);
      res.locals.principal = principal;
      next();
    } catch (error) {
      next(error);
    }
  };
}
export function lazyIndexes(build: () => Promise<void>) {
  let promise: Promise<void> | undefined;
  return () => {
    promise ??= build().catch((error) => {
      promise = undefined;
      throw error;
    });
    return promise;
  };
}
export function json(res: Response, data: unknown, status = 200) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ data, meta: { requestId: res.locals.requestId } });
}
export function requireIdempotency(req: Request) {
  const key = req.get('idempotency-key');
  if (!key || key.length < 16 || key.length > 128)
    throw new HttpError(400, 'IDEMPOTENCY_REQUIRED', 'A valid idempotency key is required');
  return key;
}
