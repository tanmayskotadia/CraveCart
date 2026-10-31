import type { Express } from 'express';
import { resolve, sep } from 'node:path';
import { unlink } from 'node:fs/promises';
import { installPrivacyOwner, unseal, type DomainContext } from '@cravecart/platform';
export function installUtilsPrivacy(app: Express, ctx: DomainContext) {
  installPrivacyOwner(app, ctx, 'utils', {
    datasets: [
      {
        name: 'verified_captures',
        collection: 'captures',
        subjectField: 'userId',
        fields: [
          'orderId',
          'attemptId',
          'gateway',
          'mode',
          'paymentRef',
          'amountMinor',
          'currency',
          'refundedMinor',
          'createdAt',
        ],
      },
      {
        name: 'payments',
        collection: 'payment_attempts',
        subjectField: 'userId',
        fields: [
          'orderId',
          'gateway',
          'state',
          'amountMinor',
          'currency',
          'mode',
          'createdAt',
          'updatedAt',
        ],
      },
      {
        name: 'refunds',
        collection: 'refunds',
        subjectField: 'userId',
        fields: ['orderId', 'amountMinor', 'currency', 'state', 'reason', 'createdAt', 'updatedAt'],
      },
      {
        name: 'uploads',
        collection: 'uploads',
        subjectField: 'userId',
        fields: ['purpose', 'filename', 'size', 'mime', 'status', 'createdAt'],
      },
      {
        name: 'assistant_history',
        collection: 'assistant_conversations',
        subjectField: 'userId',
        fields: ['title', 'createdAt', 'updatedAt', 'turns'],
        decode: (row) => ({
          _id: row._id,
          title: row.title,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          turns: JSON.parse(
            unseal(
              Buffer.from(String(row.turns), 'base64'),
              ctx.config.AUTH_ENCRYPTION_KEY,
            ).toString(),
          ),
        }),
      },
    ],
    preflight: async (userId) =>
      (await ctx.db
        .collection('payment_attempts')
        .findOne({ userId, state: { $nin: ['CAPTURED', 'CLOSED'] } }))
        ? ['A payment still needs provider resolution.']
        : [],
    erase: async (userId, session) => {
      const conversations = await ctx.db
        .collection('assistant_conversations')
        .find({ userId }, { session, projection: { _id: 1 } })
        .toArray();
      await ctx.db
        .collection('assistant_requests')
        .deleteMany(
          { conversationId: { $in: conversations.map((row) => String(row._id)) } },
          { session },
        );
      for (const collection of ['assistant_conversations', 'assistant_actions'])
        await ctx.db.collection(collection).deleteMany({ userId }, { session });
      return ['Provider payment/refund/ledger evidence and private verification uploads'];
    },
    minimizeRetained: async (userId, session) => {
      const uploads = await ctx.db
        .collection('uploads')
        .find({ userId }, { session, projection: { _id: 1 } })
        .toArray();
      for (const upload of uploads)
        if (/^[a-f0-9-]{36}$/.test(String(upload._id)))
          await ctx.db
            .collection('privacy_file_deletions')
            .updateOne(
              { _id: upload._id },
              { $setOnInsert: { pending: true } },
              { upsert: true, session },
            );
      await ctx.db.collection('uploads').deleteMany({ userId }, { session });
      await ctx.db
        .collection('refunds')
        .updateMany({ userId }, { $set: { reason: 'Removed after retention' } }, { session });
    },
  });
  let running: Promise<void> | undefined;
  async function removeFile() {
    const job = await ctx.db.collection('privacy_file_deletions').findOne({ pending: true });
    if (!job) return;
    const id = String(job._id);
    if (!/^[a-f0-9-]{36}$/.test(id)) return;
    const root = resolve(ctx.config.UPLOAD_DIRECTORY),
      path = resolve(root, `${id}.encrypted`);
    if (!path.startsWith(root + sep)) return;
    try {
      await unlink(path);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
    }
    await ctx.db
      .collection('privacy_file_deletions')
      .updateOne({ _id: job._id }, { $set: { pending: false } });
  }
  const timer = setInterval(() => {
    running ??= removeFile()
      .catch(() => {})
      .finally(() => {
        running = undefined;
      });
  }, 30000);
  timer.unref();
  ctx.onClose?.(async () => {
    clearInterval(timer);
    await running;
  });
}
