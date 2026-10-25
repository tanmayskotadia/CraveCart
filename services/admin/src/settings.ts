import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { z } from 'zod';
import {
  policyKindSchema,
  policyDraftSchema,
  policyPublishSchema,
  type PolicyKind,
  type PolicyContent,
  type PublishedPolicy,
} from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  internalOnly,
  requireIdempotency,
  HttpError,
  json,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce } from '@cravecart/persistence';
interface PolicyRecord {
  _id: PolicyKind;
  version: number;
  draft: PolicyContent | null;
  draftBy: string | null;
  published: PublishedPolicy | null;
}
export function installSettings(app: Express, ctx: DomainContext) {
  const { db, client } = ctx,
    policies = db.collection<PolicyRecord>('policies');
  const empty = (kind: PolicyKind): PolicyRecord => ({
    _id: kind,
    version: 0,
    draft: null,
    draftBy: null,
    published: null,
  });
  const present = ({ _id, ...value }: PolicyRecord) => ({ kind: _id, ...value });
  app.get('/api/v1/policies/:kind', async (req, res) => {
    const kind = policyKindSchema.parse(req.params.kind),
      query = z.object({ revision: z.string().uuid().optional() }).strict().parse(req.query);
    if (query.revision) {
      const revision = await db
        .collection<
          PublishedPolicy & { _id: string; draftedBy: string; publishedBy: string; reason: string }
        >('policy_revisions')
        .findOne({ _id: query.revision, kind });
      if (!revision) throw new HttpError(404, 'NOT_FOUND', 'Published policy revision not found');
      const {
        _id: _id,
        draftedBy: _drafted,
        publishedBy: _published,
        reason: _reason,
        ...publicRevision
      } = revision;
      json(res, publicRevision);
      return;
    }
    const record = await policies.findOne({ _id: kind });
    if (!record?.published)
      throw new HttpError(
        404,
        'POLICY_UNPUBLISHED',
        'This policy has not been published yet. Please contact support before placing an order.',
      );
    json(res, record.published);
  });
  app.get(
    '/api/v1/admin/settings',
    remoteSession(ctx, { permission: 'staff:read' }),
    async (_req, res) => {
      const records = await policies.find({}).toArray();
      json(res, {
        policies: policyKindSchema.options.map((kind) =>
          present(records.find((record) => record._id === kind) ?? empty(kind)),
        ),
        commerceMode: ctx.config.COMMERCE_MODE,
        financeThresholdMinor: ctx.config.FINANCE_DUAL_APPROVAL_THRESHOLD_MINOR,
      });
    },
  );
  app.put(
    '/api/v1/admin/settings/policies/:kind',
    remoteSession(ctx, { permission: 'staff:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const kind = policyKindSchema.parse(req.params.kind),
        input = policyDraftSchema.parse(req.body),
        actor = currentPrincipal(res);
      const result = await executeOnce(
        client,
        db,
        `policy-draft:${kind}:${actor.userId}`,
        requireIdempotency(req),
        input,
        async (session) => {
          const old = (await policies.findOne({ _id: kind }, { session })) ?? empty(kind);
          if (old.version !== input.expectedVersion)
            throw new HttpError(
              409,
              'VERSION_CONFLICT',
              'Policy changed. Reload it before saving.',
            );
          const record = {
            ...old,
            version: old.version + 1,
            draft: input.content,
            draftBy: actor.userId,
          };
          await policies.replaceOne({ _id: kind }, record, { upsert: true, session });
          await db.collection('operations_audit').insertOne(
            {
              _id: randomUUID() as never,
              actorId: actor.userId,
              action: 'policy.draft-saved',
              resourceId: kind,
              reason: input.reason,
              beforeVersion: old.version,
              afterVersion: record.version,
              correlationId: res.locals.requestId,
              at: new Date().toISOString(),
            },
            { session },
          );
          return present(record);
        },
      );
      json(res, result);
    },
  );
  app.post(
    '/api/v1/admin/settings/policies/:kind/publish',
    remoteSession(ctx, { permission: 'staff:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const kind = policyKindSchema.parse(req.params.kind),
        input = policyPublishSchema.parse(req.body),
        actor = currentPrincipal(res);
      const result = await executeOnce(
        client,
        db,
        `policy-publish:${kind}:${actor.userId}`,
        requireIdempotency(req),
        input,
        async (session) => {
          const record = await policies.findOne(
            { _id: kind, version: input.expectedVersion },
            { session },
          );
          if (!record?.draft)
            throw new HttpError(
              409,
              'VERSION_CONFLICT',
              'Policy draft changed or is unavailable. Reload before publishing.',
            );
          if (record.draftBy === actor.userId)
            throw new HttpError(
              403,
              'SELF_APPROVAL_DENIED',
              'A different authorized reviewer must publish this draft',
            );
          const published: PublishedPolicy = {
            ...record.draft,
            id: randomUUID(),
            kind,
            version: record.version,
            publishedAt: new Date().toISOString(),
          };
          await db.collection('policy_revisions').insertOne(
            {
              _id: published.id as never,
              ...published,
              draftedBy: record.draftBy,
              publishedBy: actor.userId,
              reason: input.reason,
            },
            { session },
          );
          record.version++;
          record.published = published;
          record.draft = null;
          record.draftBy = null;
          await policies.replaceOne({ _id: kind }, record, { session });
          await db.collection('operations_audit').insertOne(
            {
              _id: randomUUID() as never,
              actorId: actor.userId,
              action: 'policy.published',
              resourceId: published.id,
              reason: input.reason,
              version: published.version,
              correlationId: res.locals.requestId,
              at: published.publishedAt,
            },
            { session },
          );
          return present(record);
        },
      );
      json(res, result);
    },
  );
  app.post(
    '/internal/v1/policies/checkout',
    internalOnly(ctx, ['restaurant']),
    async (req, res) => {
      z.object({}).strict().parse(req.body);
      const records = await policies.find({}).toArray();
      const references = policyKindSchema.options.map((kind) => {
        const published = records.find((record) => record._id === kind)?.published;
        if (!published)
          throw new HttpError(
            503,
            'POLICIES_UNPUBLISHED',
            'Reviewed terms, privacy and cancellation policies must be published before live checkout',
          );
        return { id: published.id, kind, version: published.version };
      });
      json(res, { policies: references });
    },
  );
  app.post('/internal/v1/policies/privacy', internalOnly(ctx, ['auth']), async (req, res) => {
    z.object({}).strict().parse(req.body);
    const record = await policies.findOne({ _id: 'privacy' });
    if (!record?.published)
      throw new HttpError(
        409,
        'POLICY_UNPUBLISHED',
        'Publish the reviewed privacy and retention notice first',
      );
    json(res, { id: record.published.id, version: record.published.version });
  });
}
