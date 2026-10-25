import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { z } from 'zod';
import {
  privacyRequestInputSchema,
  privacyDecisionSchema,
  privacyRequestSchema,
  type PrivacyRequest,
  type Principal,
  type ServiceName,
} from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  requirePermission,
  internalOnly,
  internalCall,
  requireIdempotency,
  checkedId,
  HttpError,
  json,
  lazyIndexes,
  seal,
  unseal,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce } from '@cravecart/persistence';
interface Job extends Omit<PrivacyRequest, 'id'> {
  _id: string;
  leaseUntil: Date;
  nextAt: Date;
  attempts: number;
  ownerIndex: number;
  cursor: { dataset: number; after?: string } | null;
  seq: number;
  retentionDays: number | null;
  frozenAt: Date | null;
  retentionPolicyId: string | null;
}
const owners: ServiceName[] = ['restaurant', 'rider', 'utils', 'admin', 'realtime', 'auth'];
export function installPrivacy(app: Express, ctx: DomainContext) {
  const { db, client, config } = ctx,
    jobs = db.collection<Job>('privacy_requests');
  const parts = db.collection<{
    _id: string;
    requestId: string;
    sequence: number;
    sealed: string;
    expiresAt: Date;
  }>('privacy_export_parts');
  const ready = lazyIndexes(async () => {
    await jobs.createIndex({ userId: 1, requestedAt: -1 });
    await jobs.createIndex({ status: 1, nextAt: 1, leaseUntil: 1 });
    await parts.createIndex({ requestId: 1, sequence: 1 }, { unique: true });
    await parts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  });
  const present = (job: Job) =>
    privacyRequestSchema.parse(
      Object.fromEntries(
        Object.keys(privacyRequestSchema.shape).map((key) => [
          key,
          key === 'id' ? job._id : job[key as keyof Job],
        ]),
      ),
    );
  function fresh(actor: Principal) {
    if (Date.now() - Date.parse(actor.authenticatedAt) > 5 * 60000)
      throw new HttpError(
        403,
        'REAUTHENTICATION_REQUIRED',
        'Sign in again to verify your identity before this privacy action',
      );
  }
  const retentionReady = () =>
    config.PRIVACY_RETENTION_REVIEWED === 'true' &&
    Boolean(config.PRIVACY_FINANCIAL_RETENTION_DAYS);
  app.get('/api/v1/privacy/requests', remoteSession(ctx), async (_req, res) => {
    await ready();
    json(
      res,
      (
        await jobs
          .find({ userId: currentPrincipal(res).userId })
          .sort({ requestedAt: -1 })
          .limit(50)
          .toArray()
      ).map(present),
    );
  });
  app.post('/api/v1/privacy/requests', remoteSession(ctx, { mutation: true }), async (req, res) => {
    await ready();
    const input = privacyRequestInputSchema.parse(req.body),
      actor = currentPrincipal(res);
    fresh(actor);
    const result = await executeOnce(
      client,
      db,
      `privacy-request:${actor.userId}`,
      requireIdempotency(req),
      input,
      async (session) => {
        const open = await jobs.findOne(
          {
            userId: actor.userId,
            kind: input.kind,
            status: { $in: ['AWAITING_REVIEW', 'PREFLIGHT', 'PROCESSING', 'BLOCKED'] },
          },
          { session },
        );
        if (open)
          throw new HttpError(
            409,
            'REQUEST_OPEN',
            'You already have an open privacy request of this kind',
          );
        const job: Job = {
          _id: randomUUID(),
          userId: actor.userId,
          kind: input.kind,
          status: 'AWAITING_REVIEW',
          version: 1,
          requestedAt: new Date().toISOString(),
          reviewedBy: null,
          reviewReason: null,
          completedAt: null,
          downloadExpiresAt: null,
          progress: 0,
          message: 'Identity verified. Awaiting independent privacy review.',
          retained: [],
          leaseUntil: new Date(0),
          nextAt: new Date(0),
          attempts: 0,
          ownerIndex: 0,
          cursor: null,
          seq: 0,
          retentionDays: null,
          frozenAt: null,
          retentionPolicyId: null,
        };
        await jobs.insertOne(job, { session });
        return present(job);
      },
    );
    json(res, result, 202);
  });
  app.post(
    '/api/v1/privacy/requests/:requestId/cancel',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      const input = z
          .object({ expectedVersion: z.number().int().positive() })
          .strict()
          .parse(req.body),
        actor = currentPrincipal(res);
      fresh(actor);
      const result = await executeOnce(
        client,
        db,
        `privacy-cancel:${actor.userId}`,
        requireIdempotency(req),
        { requestId: checkedId(req.params.requestId), ...input },
        async (session) => {
          const job = await jobs.findOne(
            {
              _id: checkedId(req.params.requestId),
              userId: actor.userId,
              version: input.expectedVersion,
              status: { $in: ['AWAITING_REVIEW', 'PREFLIGHT', 'BLOCKED'] },
              frozenAt: null,
            },
            { session },
          );
          if (!job)
            throw new HttpError(
              409,
              'REQUEST_CHANGED',
              'This request changed or account closure has already begun',
            );
          job.status = 'CANCELLED';
          job.version++;
          job.message = 'Cancelled by the verified account holder.';
          await jobs.replaceOne({ _id: job._id }, job, { session });
          return present(job);
        },
      );
      json(res, result);
    },
  );
  app.get('/api/v1/privacy/requests/:requestId/download', remoteSession(ctx), async (req, res) => {
    const actor = currentPrincipal(res);
    fresh(actor);
    await ready();
    const job = await jobs.findOne({
      _id: checkedId(req.params.requestId),
      userId: actor.userId,
      kind: 'export',
      status: 'READY',
    });
    if (!job || !job.downloadExpiresAt || Date.parse(job.downloadExpiresAt) <= Date.now())
      throw new HttpError(
        410,
        'EXPORT_UNAVAILABLE',
        'This private export is unavailable or expired. Request a fresh export.',
      );
    await db
      .collection('privacy_audit')
      .insertOne({
        _id: randomUUID() as never,
        actorId: actor.userId,
        requestId: job._id,
        action: 'export.download',
        at: new Date(),
      });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="CraveCart-data-${job._id}.json"`);
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      res.write(
        JSON.stringify({
          requestId: job._id,
          collectedAt: job.completedAt,
          scope:
            'Owner-scoped account datasets, collected during the request window. Security secrets and unrelated participants are excluded. Upload metadata identifies files available through the existing private document flow.',
        }).slice(0, -1) + ',"parts":[',
      );
      let comma = false;
      for await (const part of parts.find({ requestId: job._id }).sort({ sequence: 1 })) {
        const text = unseal(
          Buffer.from(part.sealed, 'base64'),
          config.AUTH_ENCRYPTION_KEY,
        ).toString();
        if (!res.write((comma ? ',' : '') + text))
          await new Promise<void>((resolve) => res.once('drain', resolve));
        comma = true;
      }
      res.end(']}');
    } catch {
      res.destroy();
    }
  });
  app.post('/internal/v1/privacy/admin-list', internalOnly(ctx, ['admin']), async (req, res) => {
    const input = z
      .object({
        actorSessionId: z.string().uuid(),
        page: z.number().int().min(1).max(10000).default(1),
      })
      .strict()
      .parse(req.body);
    const actor = await internalCall<Principal>(ctx, 'auth', '/internal/v1/sessions/inspect', {
      sessionId: input.actorSessionId,
    });
    requirePermission(actor, 'users:read');
    await ready();
    json(res, {
      requests: (
        await jobs
          .find({})
          .sort({ requestedAt: -1, _id: -1 })
          .skip((input.page - 1) * 20)
          .limit(20)
          .toArray()
      ).map(present),
      total: await jobs.countDocuments({}),
      page: input.page,
      pageSize: 20,
      retentionConfigured: retentionReady(),
    });
  });
  app.post(
    '/internal/v1/privacy/admin-decision',
    internalOnly(ctx, ['admin']),
    async (req, res) => {
      const input = z
        .object({
          actorSessionId: z.string().uuid(),
          requestId: z.string().uuid(),
          commandId: z.string().min(16),
          ...privacyDecisionSchema.shape,
        })
        .strict()
        .parse(req.body);
      const actor = await internalCall<Principal>(ctx, 'auth', '/internal/v1/sessions/inspect', {
        sessionId: input.actorSessionId,
      });
      requirePermission(actor, 'users:write', true);
      await ready();
      const current = await jobs.findOne({ _id: input.requestId });
      if (!current) throw new HttpError(404, 'NOT_FOUND', 'Privacy request not found');
      if (current.userId === actor.userId)
        throw new HttpError(
          403,
          'SELF_APPROVAL_DENIED',
          'An independent privacy reviewer is required',
        );
      let policyId: string | null = null;
      if (current.kind === 'delete' && input.action !== 'reject') {
        if (!retentionReady())
          throw new HttpError(
            409,
            'RETENTION_UNAPPROVED',
            'Configure reviewed financial retention before approving account closure',
          );
        const policy = await internalCall<{ id: string }>(
          ctx,
          'admin',
          '/internal/v1/policies/privacy',
          {},
        );
        policyId = policy.id;
      }
      const result = await executeOnce(
        client,
        db,
        `privacy-review:${actor.userId}:${input.requestId}`,
        input.commandId,
        { expectedVersion: input.expectedVersion, action: input.action, reason: input.reason },
        async (session) => {
          const job = await jobs.findOne(
            {
              _id: input.requestId,
              version: input.expectedVersion,
              status: { $in: input.action === 'retry' ? ['BLOCKED'] : ['AWAITING_REVIEW'] },
            },
            { session },
          );
          if (!job)
            throw new HttpError(
              409,
              'REQUEST_CHANGED',
              'Privacy request changed. Reload before reviewing.',
            );
          job.status =
            input.action === 'reject'
              ? 'REJECTED'
              : job.kind === 'delete' && !job.frozenAt
                ? 'PREFLIGHT'
                : 'PROCESSING';
          job.version++;
          job.reviewedBy = actor.userId;
          job.reviewReason = input.reason;
          job.attempts = 0;
          job.nextAt = new Date(0);
          job.leaseUntil = new Date(0);
          if (input.action !== 'reject' && !job.frozenAt) {
            job.retentionDays = config.PRIVACY_FINANCIAL_RETENTION_DAYS ?? null;
            job.retentionPolicyId = policyId;
          }
          job.message =
            input.action === 'reject'
              ? 'Request rejected after independent review.'
              : 'Reviewed. Owner-scoped processing is queued.';
          await jobs.replaceOne({ _id: job._id }, job, { session });
          await db
            .collection('privacy_audit')
            .insertOne(
              {
                _id: randomUUID() as never,
                actorId: actor.userId,
                userId: job.userId,
                requestId: job._id,
                action: `request.${input.action}`,
                reason: input.reason,
                version: job.version,
                retentionPolicyId: job.retentionPolicyId,
                correlationId: res.locals.requestId,
                at: new Date(),
              },
              { session },
            );
          return present(job);
        },
      );
      json(res, result, 202);
    },
  );
  app.post(
    '/internal/v1/privacy/authorize',
    internalOnly(ctx, ['auth', 'restaurant', 'rider', 'utils', 'admin', 'realtime']),
    async (req, res) => {
      const input = z
        .object({
          requestId: z.string().uuid(),
          userId: z.string().uuid(),
          purpose: z.enum(['export', 'preflight', 'erase']),
          owner: z.enum(['auth', 'restaurant', 'rider', 'utils', 'admin', 'realtime']),
        })
        .strict()
        .parse(req.body);
      if (res.locals.caller !== input.owner)
        throw new HttpError(403, 'SERVICE_DENIED', 'Privacy caller mismatch');
      const job = await jobs.findOne({
        _id: input.requestId,
        userId: input.userId,
        reviewedBy: { $ne: null },
      });
      if (
        !job ||
        (input.purpose === 'export'
          ? job.kind !== 'export' || job.status !== 'PROCESSING'
          : job.kind !== 'delete' || !['PREFLIGHT', 'PROCESSING'].includes(job.status)) ||
        (input.purpose === 'erase' && !job.frozenAt)
      )
        throw new HttpError(
          403,
          'PRIVACY_SCOPE_DENIED',
          'This privacy operation is not authorized',
        );
      json(res, { retentionDays: job.retentionDays });
    },
  );
  let running: Promise<void> | undefined;
  async function work() {
    await ready();
    const job = await jobs.findOneAndUpdate(
      {
        status: { $in: ['PREFLIGHT', 'PROCESSING'] },
        nextAt: { $lte: new Date() },
        leaseUntil: { $lte: new Date() },
      },
      { $set: { leaseUntil: new Date(Date.now() + 30000) } },
      { sort: { requestedAt: 1 }, returnDocument: 'after' },
    );
    if (!job) return;
    const initialVersion = job.version;
    try {
      const owner = owners[job.ownerIndex];
      if (job.status === 'PREFLIGHT') {
        const result = await internalCall<{ blockers: string[] }>(
          ctx,
          owner!,
          '/internal/v1/privacy-owner/preflight',
          { requestId: job._id, userId: job.userId },
        );
        if (result.blockers.length) {
          job.status = 'BLOCKED';
          job.message = result.blockers.join('; ');
          job.ownerIndex = 0;
        } else if (++job.ownerIndex === owners.length) {
          const session = client.startSession();
          try {
            await session.withTransaction(async () => {
              const stored = await jobs.findOne(
                { _id: job._id, version: job.version, status: 'PREFLIGHT' },
                { session },
              );
              if (!stored) throw new HttpError(409, 'REQUEST_CHANGED', 'Request changed');
              await db
                .collection('users')
                .updateOne(
                  { _id: job.userId as never },
                  { $set: { status: 'SUSPENDED' } },
                  { session },
                );
              await db
                .collection('sessions')
                .updateMany(
                  { userId: job.userId },
                  { $set: { revokedAt: new Date() } },
                  { session },
                );
              const next = {
                ...stored,
                status: 'PROCESSING' as const,
                ownerIndex: 0,
                frozenAt: new Date(),
                message:
                  'Account access ended. Waiting for in-flight requests to drain before owner erasure.',
                version: stored.version + 1,
                nextAt: new Date(Date.now() + 60000),
                leaseUntil: new Date(0),
              };
              await jobs.replaceOne({ _id: job._id, version: stored.version }, next, { session });
            });
          } finally {
            await session.endSession();
          }
          return;
        }
      } else if (job.kind === 'export') {
        const data = await internalCall<{
          dataset: string | null;
          records: unknown[];
          next: Job['cursor'];
        }>(ctx, owner!, '/internal/v1/privacy-owner/export', {
          requestId: job._id,
          userId: job.userId,
          ...(job.cursor ?? {}),
        });
        const text = JSON.stringify({
          owner,
          dataset: data.dataset,
          checkedAt: new Date().toISOString(),
          records: data.records,
        });
        if (Buffer.byteLength(text) > 2 * 1024 * 1024)
          throw new HttpError(
            409,
            'EXPORT_PART_TOO_LARGE',
            'A dataset needs manual privacy fulfilment because its safe export part limit was exceeded',
          );
        const session = client.startSession();
        try {
          await session.withTransaction(async () => {
            const current = await jobs.findOne(
              { _id: job._id, version: initialVersion, status: 'PROCESSING' },
              { session },
            );
            if (!current) throw new HttpError(409, 'REQUEST_CHANGED', 'Request changed');
            const next = { ...current };
            await parts.insertOne(
              {
                _id: randomUUID(),
                requestId: job._id,
                sequence: next.seq++,
                sealed: seal(Buffer.from(text), config.AUTH_ENCRYPTION_KEY).toString('base64'),
                expiresAt: new Date(Date.now() + 7 * 86400000),
              },
              { session },
            );
            next.cursor = data.next;
            if (!data.next) next.ownerIndex++;
            if (next.ownerIndex === owners.length) {
              next.status = 'READY';
              next.completedAt = new Date().toISOString();
              next.downloadExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
              next.message =
                'Private account export ready. Download requires a fresh sign-in and expires after seven days.';
              await parts.updateMany(
                { requestId: job._id },
                { $set: { expiresAt: new Date(next.downloadExpiresAt) } },
                { session },
              );
            }
            next.version++;
            next.progress++;
            next.nextAt = new Date(0);
            next.leaseUntil = new Date(0);
            await jobs.replaceOne({ _id: job._id, version: current.version }, next, { session });
          });
        } finally {
          await session.endSession();
        }
        return;
      } else {
        if (!job.frozenAt || Date.now() - job.frozenAt.getTime() < 60000) {
          job.nextAt = new Date(Date.now() + 5000);
        } else {
          const result = await internalCall<{ retained: string[] }>(
            ctx,
            owner!,
            '/internal/v1/privacy-owner/erase',
            { requestId: job._id, userId: job.userId },
          );
          job.retained.push(...result.retained);
          job.ownerIndex++;
          if (job.ownerIndex === owners.length) {
            await db
              .collection('users')
              .updateOne(
                { _id: job.userId as never },
                {
                  $set: {
                    contact: `deleted-${job.userId}@deleted.invalid`,
                    name: 'Deleted account',
                    status: 'SUSPENDED',
                    roles: ['customer'],
                    permissions: [],
                  },
                  $unset: { mfaSecret: '', backupHashes: '', lastTotpCounter: '' },
                },
              );
            await db.collection('refresh_tokens').deleteMany({ userId: job.userId });
            await db
              .collection('privacy_export_parts')
              .deleteMany({
                requestId: {
                  $in: (
                    await jobs
                      .find({ userId: job.userId, kind: 'export' }, { projection: { _id: 1 } })
                      .toArray()
                  ).map((value) => value._id),
                },
              });
            job.status = 'COMPLETED_WITH_RETENTION';
            job.completedAt = new Date().toISOString();
            job.message =
              'Account access ended and operational data erased. Listed financial/legal records remain until the reviewed retention deadline; owners minimize them afterwards.';
          }
        }
      }
      job.version++;
      job.progress++;
      job.leaseUntil = new Date(0);
      job.nextAt = new Date(Date.now() + 1000);
      await jobs.replaceOne({ _id: job._id, version: initialVersion }, job);
    } catch (error) {
      const permanent = error instanceof HttpError && error.status >= 400 && error.status < 500;
      await jobs.updateOne(
        { _id: job._id, version: initialVersion },
        {
          $set: {
            status: permanent || job.attempts >= 4 ? 'BLOCKED' : job.status,
            message: permanent
              ? (error as HttpError).message
              : 'An owner service is unavailable. Processing will retry; no fulfilment is claimed.',
            leaseUntil: new Date(0),
            nextAt: new Date(Date.now() + 10000),
          },
          $inc: { attempts: 1 },
        },
      );
    }
  }
  function tick() {
    running ??= work().finally(() => {
      running = undefined;
    });
    return running;
  }
  const timer = setInterval(() => void tick().catch(() => {}), 2000);
  timer.unref();
  ctx.onClose?.(async () => {
    clearInterval(timer);
    await running;
  });
  return { tick };
}
