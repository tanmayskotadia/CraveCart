import type { Express } from 'express';
import type { ClientSession, Document } from 'mongodb';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { executeOnce } from '@cravecart/persistence';
import {
  internalOnly,
  internalCall,
  HttpError,
  json,
  lazyIndexes,
  type DomainContext,
} from './security.js';
// Owners supply fixed datasets/projections. HTTP callers cannot choose collection names or fields.
export interface PrivacyDataset {
  name: string;
  collection: string;
  subjectField: string;
  fields: string[];
  decode?: (row: Document) => Document;
}
export interface PrivacyOwnerOptions {
  datasets: PrivacyDataset[];
  preflight: (userId: string) => Promise<string[]>;
  erase: (userId: string, session: ClientSession) => Promise<string[]>;
  minimizeRetained: (userId: string, session: ClientSession) => Promise<void>;
}
export function installPrivacyOwner(
  app: Express,
  ctx: DomainContext,
  owner: string,
  options: PrivacyOwnerOptions,
) {
  const inputSchema = z
    .object({
      requestId: z.string().uuid(),
      userId: z.string().uuid(),
      dataset: z.number().int().nonnegative().optional(),
      after: z.string().max(128).optional(),
    })
    .strict();
  const subjects = ctx.db.collection<{
    _id: string;
    requestId: string;
    dueAt: Date;
    minimized: boolean;
  }>('privacy_subjects');
  const ready = lazyIndexes(async () => {
    await subjects.createIndex({ minimized: 1, dueAt: 1 });
    for (const dataset of options.datasets)
      if (dataset.subjectField !== '_id')
        await ctx.db
          .collection(dataset.collection)
          .createIndex({ [dataset.subjectField]: 1, _id: 1 });
  });
  async function authorize(input: z.infer<typeof inputSchema>, purpose: string) {
    return internalCall<{ retentionDays: number | null }>(
      ctx,
      'auth',
      '/internal/v1/privacy/authorize',
      { requestId: input.requestId, userId: input.userId, purpose, owner },
    );
  }
  app.post('/internal/v1/privacy-owner/export', internalOnly(ctx, ['auth']), async (req, res) => {
    const input = inputSchema.parse(req.body);
    await authorize(input, 'export');
    await ready();
    const index = input.dataset ?? 0,
      dataset = options.datasets[index];
    if (!dataset) {
      json(res, { dataset: null, records: [], next: null });
      return;
    }
    const projection = Object.fromEntries(['_id', ...dataset.fields].map((field) => [field, 1]));
    const after =
      input.after?.startsWith('oid:') && /^[a-f0-9]{24}$/.test(input.after.slice(4))
        ? new ObjectId(input.after.slice(4))
        : input.after;
    const records = await ctx.db
      .collection(dataset.collection)
      .find(
        {
          [dataset.subjectField]: input.userId,
          ...(after ? { _id: { $gt: after as never } } : {}),
        },
        { projection },
      )
      .sort({ _id: 1 })
      .limit(100)
      .toArray();
    const output: Document[] = [];
    let bytes = 0;
    for (const row of records) {
      const value = dataset.decode ? dataset.decode(row) : row;
      const size = Buffer.byteLength(JSON.stringify(value));
      if (size > 1024 * 1024)
        throw new HttpError(
          409,
          'EXPORT_RECORD_TOO_LARGE',
          'A record requires reviewed manual export',
        );
      if (output.length && bytes + size > 1024 * 1024) break;
      output.push(value);
      bytes += size;
    }
    const last = records[output.length - 1]?._id;
    const next =
      last && (records.length === 100 || output.length < records.length)
        ? { dataset: index, after: last instanceof ObjectId ? `oid:${last}` : String(last) }
        : index + 1 < options.datasets.length
          ? { dataset: index + 1 }
          : null;
    json(res, { dataset: dataset.name, records: output, next });
  });
  app.post(
    '/internal/v1/privacy-owner/preflight',
    internalOnly(ctx, ['auth']),
    async (req, res) => {
      const input = inputSchema.parse(req.body);
      await authorize(input, 'preflight');
      json(res, { blockers: await options.preflight(input.userId) });
    },
  );
  app.post('/internal/v1/privacy-owner/erase', internalOnly(ctx, ['auth']), async (req, res) => {
    const input = inputSchema.parse(req.body),
      policy = await authorize(input, 'erase');
    await ready();
    if (!policy.retentionDays)
      throw new HttpError(
        409,
        'RETENTION_UNAPPROVED',
        'Reviewed retention configuration is required',
      );
    const blockers = await options.preflight(input.userId);
    if (blockers.length) throw new HttpError(409, 'PRIVACY_OBLIGATIONS_OPEN', blockers.join('; '));
    const result = await executeOnce(
      ctx.client,
      ctx.db,
      `privacy-erasure:${owner}:${input.userId}`,
      input.requestId,
      { userId: input.userId },
      async (session) => {
        await ctx.db
          .collection('privacy_subjects')
          .updateOne(
            { _id: input.userId as never },
            { $set: { closing: true }, $inc: { epoch: 1 } },
            { upsert: true, session },
          );
        const retained = await options.erase(input.userId, session);
        await subjects.updateOne(
          { _id: input.userId },
          {
            $set: {
              requestId: input.requestId,
              dueAt: new Date(Date.now() + policy.retentionDays! * 86400000),
              minimized: false,
            },
          },
          { upsert: true, session },
        );
        return {
          retained: retained.map(
            (value) =>
              `${owner}: ${value}; retention ${policy.retentionDays} days after account closure`,
          ),
        };
      },
    );
    json(res, result);
  });
  let running: Promise<void> | undefined;
  async function sweep() {
    await ready();
    const subject = await subjects.findOne({ dueAt: { $lte: new Date() }, minimized: false });
    if (!subject || (await options.preflight(subject._id)).length) return;
    const session = ctx.client.startSession();
    try {
      await session.withTransaction(async () => {
        await options.minimizeRetained(subject._id, session);
        await subjects.updateOne(
          { _id: subject._id, minimized: false },
          { $set: { minimized: true } },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
  }
  const timer = setInterval(() => {
    running ??= sweep()
      .catch(() => {})
      .finally(() => {
        running = undefined;
      });
  }, 60000);
  timer.unref();
  ctx.onClose?.(async () => {
    clearInterval(timer);
    await running;
  });
}
