import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { z } from 'zod';
import type {
  PaymentAttempt,
  Refund,
  Gateway,
  PayableOrder,
  CommerceMode,
} from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  internalOnly,
  internalCall,
  checkedId,
  HttpError,
  json,
  lazyIndexes,
  requireIdempotency,
  requirePermission,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce, enqueueEvent } from '@cravecart/persistence';
import {
  Gateways,
  gatewayCapabilities,
  verifyWebhook,
  type CaptureProof,
  type WebhookHint,
  type ProviderRefund,
} from './gateways.js';

interface Attempt extends Omit<PaymentAttempt, 'id' | 'reconciliationRequired'> {
  _id: string;
  userId: string;
  payable: PayableOrder;
  leaseUntil: Date;
  nextCheckAt: Date;
  primaryCaptureId?: string;
  checks: number;
}
interface Capture {
  _id: string;
  attemptId: string;
  orderId: string;
  userId: string;
  gateway: Gateway;
  mode: CommerceMode;
  paymentRef: string;
  amountMinor: number;
  currency: 'INR';
  primary: boolean;
  acknowledged: boolean;
  refundReservedMinor: number;
  refundedMinor: number;
  createdAt: string;
  nextAttemptAt: Date;
  leaseUntil: Date;
}
interface RefundRecord extends Omit<Refund, 'id'> {
  _id: string;
  userId: string;
  attemptId: string;
  captureId: string;
  source: 'ORDER' | 'EXTRA_CAPTURE';
  acknowledged: boolean;
  leaseUntil: Date;
  nextCheckAt: Date;
  attempts: number;
}
interface Ledger {
  _id: string;
  orderId: string;
  mode: CommerceMode;
  currency: 'INR';
  kind: 'CAPTURE' | 'REFUND';
  amountMinor: number;
  entries: Array<{ account: string; debitMinor: number; creditMinor: number }>;
  at: string;
}
interface Inbox extends WebhookHint {
  _id: string;
  mode: CommerceMode;
  gateway: Gateway;
  state: 'NEW' | 'APPLIED' | 'UNMATCHED';
  attempts: number;
  nextCheckAt: Date;
  leaseUntil: Date;
  receivedAt: string;
  lastError: string | null;
}
export function installPayments(
  app: Express,
  ctx: DomainContext,
  options: { gatewayFetch?: typeof fetch } = {},
) {
  const { db, client, config } = ctx,
    gateways = new Gateways(config, options.gatewayFetch),
    attempts = db.collection<Attempt>('payment_attempts'),
    captures = db.collection<Capture>('captures'),
    refunds = db.collection<RefundRecord>('refunds'),
    ledger = db.collection<Ledger>('ledger'),
    inbox = db.collection<Inbox>('webhook_inbox');
  const ready = lazyIndexes(async () => {
    await attempts.createIndex({ orderId: 1 }, { unique: true });
    await attempts.createIndex(
      { mode: 1, gateway: 1, providerId: 1 },
      { unique: true, partialFilterExpression: { providerId: { $type: 'string' } } },
    );
    await attempts.createIndex({ nextCheckAt: 1, leaseUntil: 1 });
    await refunds.createIndex(
      { mode: 1, gateway: 1, providerId: 1 },
      { unique: true, partialFilterExpression: { providerId: { $type: 'string' } } },
    );
    await refunds.createIndex({ nextCheckAt: 1, leaseUntil: 1 });
    const oldInboxIndex = (
      await inbox
        .listIndexes()
        .toArray()
        .catch(() => [])
    ).find((index) => index.name === 'gateway_1_bodyHash_1' && index.unique);
    if (oldInboxIndex) await inbox.dropIndex('gateway_1_bodyHash_1');
    await inbox.createIndex({ mode: 1, gateway: 1, bodyHash: 1 }, { unique: true });
    await captures.createIndex({ acknowledged: 1, nextAttemptAt: 1 });
    await ledger.createIndex({ orderId: 1, at: 1 });
  });
  ctx.subscribe?.(
    ['order.payment-pending.v1', 'order.cancelled.v1', 'order.refund-requested.v1'],
    async (event, session) => {
      if (typeof event.data.orderId !== 'string') throw new Error('Missing order ID');
      await attempts.updateMany(
        { orderId: event.data.orderId, mode: config.COMMERCE_MODE },
        { $set: { nextCheckAt: new Date(0) } },
        { session },
      );
    },
  );
  function present(record: Attempt): PaymentAttempt {
    return {
      id: record._id,
      orderId: record.orderId,
      gateway: record.gateway,
      mode: record.mode,
      state: record.state,
      amountMinor: record.amountMinor,
      currency: record.currency,
      providerId: record.providerId,
      checkoutUrl: record.checkoutUrl,
      publicKey: record.publicKey,
      lastError: record.lastError,
      reconciliationRequired: record.state === 'UNKNOWN',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
  function presentRefund({
    _id,
    userId: _userId,
    attemptId: _aid,
    captureId: _cid,
    source: _source,
    acknowledged: _ack,
    leaseUntil: _lease,
    nextCheckAt: _next,
    attempts: _tries,
    ...value
  }: RefundRecord): Refund {
    return { id: _id, ...value };
  }
  async function owned(id: string, userId: string) {
    const record = await attempts.findOne({ _id: id, userId });
    if (!record) throw new HttpError(404, 'NOT_FOUND', 'Payment attempt not found');
    return record;
  }
  async function payable(orderId: string, userId?: string) {
    return internalCall<PayableOrder>(ctx, 'restaurant', '/internal/v1/orders/payable', {
      orderId,
      ...(userId ? { userId } : {}),
    });
  }
  async function postLedger(
    session: ClientSession,
    id: string,
    orderId: string,
    mode: CommerceMode,
    kind: 'CAPTURE' | 'REFUND',
    amountMinor: number,
  ) {
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      throw new Error('Invalid ledger amount');
    await ledger.insertOne(
      {
        _id: id,
        orderId,
        mode,
        currency: 'INR',
        kind,
        amountMinor,
        entries:
          kind === 'CAPTURE'
            ? [
                { account: 'gateway-clearing', debitMinor: amountMinor, creditMinor: 0 },
                { account: 'customer-funds', debitMinor: 0, creditMinor: amountMinor },
              ]
            : [
                { account: 'customer-funds', debitMinor: amountMinor, creditMinor: 0 },
                { account: 'gateway-clearing', debitMinor: 0, creditMinor: amountMinor },
              ],
        at: new Date().toISOString(),
      },
      { session },
    );
  }
  async function emit(
    session: ClientSession,
    type: string,
    id: string,
    orderId: string,
    data: Record<string, unknown>,
  ) {
    await enqueueEvent(db, session, {
      eventId: randomUUID(),
      eventType: type,
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      producer: 'utils',
      aggregate: { type: type.startsWith('refund.') ? 'refund' : 'payment', id, version: 1 },
      correlationId: orderId,
      causationId: id,
      data,
    });
  }
  async function reserveRefund(
    input: {
      refundId: string;
      orderId: string;
      attemptId: string;
      userId: string;
      amountMinor: number;
      reason: string;
    },
    source: 'ORDER' | 'EXTRA_CAPTURE',
    captureId?: string,
    session?: ClientSession,
  ): Promise<Refund> {
    if (!session) {
      const transaction = client.startSession();
      try {
        return (await transaction.withTransaction(() =>
          reserveRefund(input, source, captureId, transaction),
        ))!;
      } finally {
        await transaction.endSession();
      }
    }
    const existing = await refunds.findOne({ _id: input.refundId }, { session });
    if (existing) {
      if (
        existing.orderId !== input.orderId ||
        existing.amountMinor !== input.amountMinor ||
        existing.attemptId !== input.attemptId
      )
        throw new HttpError(
          409,
          'REFUND_CONFLICT',
          'Refund reference already belongs to another authorization',
        );
      return presentRefund(existing);
    }
    const attempt = await attempts.findOne(
      { _id: input.attemptId, orderId: input.orderId, userId: input.userId },
      { session },
    );
    if (attempt?.mode !== config.COMMERCE_MODE)
      throw new HttpError(409, 'ENVIRONMENT_MISMATCH', 'Refund environment is not active');
    if (!attempt.primaryCaptureId)
      throw new HttpError(
        409,
        'CAPTURE_NOT_FOUND',
        'A verified capture is required before refunding',
      );
    const capture = await captures.findOne(
      { _id: captureId ?? attempt.primaryCaptureId },
      { session },
    );
    if (
      !capture ||
      capture.orderId !== input.orderId ||
      input.amountMinor <= 0 ||
      capture.refundReservedMinor + input.amountMinor > capture.amountMinor
    )
      throw new HttpError(
        409,
        'REFUND_LIMIT',
        'Refunds cannot exceed the verified captured amount',
      );
    await captures.updateOne(
      { _id: capture._id },
      { $inc: { refundReservedMinor: input.amountMinor } },
      { session },
    );
    const now = new Date().toISOString(),
      record: RefundRecord = {
        _id: input.refundId,
        orderId: input.orderId,
        userId: input.userId,
        attemptId: input.attemptId,
        captureId: capture._id,
        source,
        gateway: attempt.gateway,
        mode: attempt.mode,
        amountMinor: input.amountMinor,
        currency: 'INR',
        state: 'NEW',
        providerId: null,
        reason: input.reason,
        createdAt: now,
        updatedAt: now,
        lastError: null,
        acknowledged: source === 'EXTRA_CAPTURE',
        leaseUntil: new Date(0),
        nextCheckAt: new Date(0),
        attempts: 0,
      };
    await refunds.insertOne(record, { session });
    await emit(session, 'refund.requested.v1', record._id, record.orderId, {
      refundId: record._id,
      orderId: record.orderId,
      amountMinor: record.amountMinor,
      currency: 'INR',
    });
    return presentRefund(record);
  }
  async function recordCapture(attempt: Attempt, proof: CaptureProof) {
    if (proof.amountMinor !== attempt.amountMinor || proof.currency !== attempt.currency)
      throw new HttpError(409, 'PAYMENT_MISMATCH', 'Captured amount or currency does not match');
    const id = `${attempt.mode}:${attempt.gateway}:${proof.paymentRef}`,
      session = client.startSession();
    try {
      await session.withTransaction(async () => {
        if (await captures.findOne({ _id: id }, { session })) return;
        const current = await attempts.findOne({ _id: attempt._id }, { session });
        if (!current) throw new HttpError(404, 'NOT_FOUND', 'Payment attempt not found');
        const primary = !current.primaryCaptureId,
          now = new Date().toISOString(),
          capture: Capture = {
            _id: id,
            attemptId: attempt._id,
            orderId: attempt.orderId,
            userId: attempt.userId,
            gateway: attempt.gateway,
            mode: attempt.mode,
            paymentRef: proof.paymentRef,
            amountMinor: proof.amountMinor,
            currency: 'INR',
            primary,
            acknowledged: !primary,
            refundReservedMinor: 0,
            refundedMinor: 0,
            createdAt: now,
            nextAttemptAt: new Date(0),
            leaseUntil: new Date(0),
          };
        await captures.insertOne(capture, { session });
        await attempts.updateOne(
          { _id: attempt._id },
          {
            $set: {
              state: 'CAPTURED',
              updatedAt: now,
              ...(primary ? { primaryCaptureId: id } : {}),
              lastError: primary ? null : 'EXTRA_CAPTURE_REQUIRES_COMPENSATION',
            },
          },
          { session },
        );
        await postLedger(
          session,
          `capture:${id}`,
          attempt.orderId,
          attempt.mode,
          'CAPTURE',
          proof.amountMinor,
        );
        await emit(session, 'payment.captured.v1', attempt._id, attempt.orderId, {
          orderId: attempt.orderId,
          attemptId: attempt._id,
          gateway: attempt.gateway,
          providerPaymentId: proof.paymentRef,
          amountMinor: proof.amountMinor,
          currency: 'INR',
        });
        if (!primary) {
          await db.collection('finance_exceptions').updateOne(
            { _id: id as never },
            {
              $setOnInsert: {
                orderId: attempt.orderId,
                mode: attempt.mode,
                code: 'EXTRA_CAPTURE',
                at: now,
              },
            },
            { upsert: true, session },
          );
          await reserveRefund(
            {
              refundId: randomUUID(),
              orderId: attempt.orderId,
              attemptId: attempt._id,
              userId: attempt.userId,
              amountMinor: proof.amountMinor,
              reason: 'Automatic compensation for an additional verified capture',
            },
            'EXTRA_CAPTURE',
            id,
            session,
          );
        }
      });
    } finally {
      await session.endSession();
    }
  }
  async function createProvider(id: string) {
    const attempt = await attempts.findOneAndUpdate(
      { _id: id, state: 'NEW', leaseUntil: { $lte: new Date() } },
      {
        $set: {
          state: 'CREATING',
          leaseUntil: new Date(Date.now() + 60000),
          updatedAt: new Date().toISOString(),
        },
      },
      { returnDocument: 'after' },
    );
    if (!attempt) return;
    try {
      const order = await payable(attempt.orderId, attempt.userId);
      if (order.status !== 'PAYMENT_PENDING' || order.paymentDeadline <= new Date().toISOString()) {
        await attempts.updateOne(
          { _id: id },
          {
            $set: { state: 'CLOSED', leaseUntil: new Date(0), updatedAt: new Date().toISOString() },
          },
        );
        return;
      }
      if (
        order.attemptId !== id ||
        order.amountMinor !== attempt.amountMinor ||
        order.gateway !== attempt.gateway ||
        order.mode !== attempt.mode
      )
        throw new HttpError(409, 'PAYABLE_MISMATCH', 'Order terms changed');
      const result =
        attempt.mode === 'development'
          ? {
              providerId: `dev_${attempt.gateway}_${id.replaceAll('-', '')}`,
              checkoutUrl: null,
              publicKey: null,
            }
          : await gateways.create(order);
      await attempts.updateOne(
        { _id: id, state: 'CREATING' },
        {
          $set: {
            ...result,
            state: 'READY',
            leaseUntil: new Date(0),
            lastError: null,
            updatedAt: new Date().toISOString(),
            nextCheckAt: new Date(),
          },
        },
      );
    } catch (error) {
      await attempts.updateOne(
        { _id: id, state: 'CREATING' },
        {
          $set: {
            state: 'UNKNOWN',
            leaseUntil: new Date(0),
            lastError: error instanceof HttpError ? error.code : 'PROVIDER_RESULT_UNKNOWN',
            updatedAt: new Date().toISOString(),
            nextCheckAt: new Date(Date.now() + 30000),
          },
        },
      );
    }
  }
  async function ensureAttempt(orderId: string, userId: string, key: string) {
    const order = await payable(orderId, userId);
    if (
      order.mode !== config.COMMERCE_MODE ||
      !gatewayCapabilities(config).gateways.includes(order.gateway)
    )
      throw new HttpError(
        503,
        'GATEWAY_UNAVAILABLE',
        'Gateway configuration does not match this order',
      );
    const existing = await attempts.findOne({ _id: order.attemptId, userId });
    if (existing) return existing;
    if (order.status !== 'PAYMENT_PENDING' || order.paymentDeadline <= new Date().toISOString())
      throw new HttpError(409, 'ORDER_NOT_PAYABLE', 'Order is no longer payable');
    const result = await executeOnce(
      client,
      db,
      `${userId}:payment-attempt`,
      key,
      { orderId },
      async (session) => {
        const found = await attempts.findOne({ _id: order.attemptId }, { session });
        if (found) return found;
        const now = new Date().toISOString(),
          record: Attempt = {
            _id: order.attemptId,
            orderId,
            userId,
            gateway: order.gateway,
            mode: order.mode,
            state: 'NEW',
            amountMinor: order.amountMinor,
            currency: 'INR',
            providerId: null,
            checkoutUrl: null,
            publicKey: null,
            lastError: null,
            createdAt: now,
            updatedAt: now,
            payable: order,
            leaseUntil: new Date(0),
            nextCheckAt: new Date(0),
            checks: 0,
          };
        await attempts.insertOne(record, { session });
        return record;
      },
    );
    return result;
  }
  async function reconcileAttempt(id: string) {
    const record = await attempts.findOneAndUpdate(
      { _id: id, mode: config.COMMERCE_MODE, leaseUntil: { $lte: new Date() } },
      { $set: { leaseUntil: new Date(Date.now() + 60000) }, $inc: { checks: 1 } },
      { returnDocument: 'after' },
    );
    if (!record) return;
    try {
      if (record.state === 'CREATING') {
        await attempts.updateOne(
          { _id: id },
          { $set: { state: 'UNKNOWN', lastError: 'CREATION_INTERRUPTED' } },
        );
        return;
      }
      if (record.state === 'NEW') {
        await attempts.updateOne({ _id: id }, { $set: { leaseUntil: new Date(0) } });
        await createProvider(id);
        return;
      }
      if (record.mode === 'development') return;
      let providerId = record.providerId;
      if (
        !providerId &&
        record.state === 'UNKNOWN' &&
        record.gateway === 'stripe' &&
        Date.now() - Date.parse(record.createdAt) < 20 * 3600000
      ) {
        const checkout = await gateways.create(record.payable);
        providerId = checkout.providerId;
        await attempts.updateOne(
          { _id: id },
          { $set: { ...checkout, state: 'READY', lastError: null } },
        );
      }
      if (!providerId) {
        if (record.state === 'UNKNOWN')
          await attempts.updateOne(
            { _id: id },
            { $set: { lastError: 'PROVIDER_REFERENCE_REQUIRES_RECONCILIATION' } },
          );
        return;
      }
      for (const proof of await gateways.captures(record.payable, providerId))
        await recordCapture(record, proof);
      const order = await payable(record.orderId);
      if (
        order.status !== 'PAYMENT_PENDING' &&
        record.state !== 'CAPTURED' &&
        order.paymentDeadline <= new Date().toISOString()
      ) {
        await gateways.expire(record.payable, providerId);
        await attempts.updateOne(
          { _id: id, state: { $ne: 'CAPTURED' } },
          { $set: { state: 'CLOSED' } },
        );
      }
    } catch (error) {
      await attempts.updateOne(
        { _id: id },
        {
          $set: {
            lastError: error instanceof HttpError ? error.code : 'RECONCILIATION_UNAVAILABLE',
          },
        },
      );
    } finally {
      await attempts.updateOne(
        { _id: id },
        {
          $set: {
            leaseUntil: new Date(0),
            nextCheckAt: new Date(Date.now() + 30000),
            updatedAt: new Date().toISOString(),
          },
        },
      );
    }
  }
  async function deliverCapture(id?: string) {
    const capture = await captures.findOneAndUpdate(
      {
        mode: config.COMMERCE_MODE,
        ...(id ? { attemptId: id } : {}),
        primary: true,
        acknowledged: false,
        leaseUntil: { $lte: new Date() },
        nextAttemptAt: { $lte: new Date() },
      },
      { $set: { leaseUntil: new Date(Date.now() + 30000) } },
      { returnDocument: 'after' },
    );
    if (!capture) return;
    try {
      const result = await internalCall<{ decision: string }>(
        ctx,
        'restaurant',
        '/internal/v1/orders/payment',
        {
          orderId: capture.orderId,
          attemptId: capture.attemptId,
          gateway: capture.gateway,
          paymentRef: capture.paymentRef,
          amountMinor: capture.amountMinor,
          currency: 'INR',
          mode: capture.mode,
        },
      );
      if (result.decision === 'EXTRA_CAPTURE')
        await reserveRefund(
          {
            refundId: capture.attemptId,
            orderId: capture.orderId,
            attemptId: capture.attemptId,
            userId: capture.userId,
            amountMinor: capture.amountMinor,
            reason: 'Compensation for an order funding-reference conflict',
          },
          'EXTRA_CAPTURE',
          capture._id,
        );
      await captures.updateOne(
        { _id: capture._id },
        { $set: { acknowledged: true, leaseUntil: new Date(0) } },
      );
    } catch {
      await captures.updateOne(
        { _id: capture._id },
        { $set: { leaseUntil: new Date(0), nextAttemptAt: new Date(Date.now() + 5000) } },
      );
    }
  }
  async function applyRefund(record: RefundRecord, proof: ProviderRefund) {
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const current = await refunds.findOne({ _id: record._id }, { session });
        if (!current || current.state === 'PROCESSED') return;
        await refunds.updateOne(
          { _id: record._id },
          {
            $set: {
              providerId: proof.id,
              state: proof.state,
              updatedAt: new Date().toISOString(),
              lastError: proof.state === 'FAILED' ? 'PROVIDER_REFUND_FAILED' : null,
            },
          },
          { session },
        );
        if (proof.state === 'PROCESSED') {
          await captures.updateOne(
            { _id: current.captureId },
            { $inc: { refundedMinor: current.amountMinor } },
            { session },
          );
          await postLedger(
            session,
            `refund:${current._id}`,
            current.orderId,
            current.mode,
            'REFUND',
            current.amountMinor,
          );
          await emit(session, 'refund.succeeded.v1', current._id, current.orderId, {
            refundId: current._id,
            orderId: current.orderId,
            amountMinor: current.amountMinor,
            currency: 'INR',
          });
        }
      });
    } finally {
      await session.endSession();
    }
  }
  async function processRefund(id?: string) {
    const record = await refunds.findOneAndUpdate(
      {
        mode: config.COMMERCE_MODE,
        ...(id ? { _id: id } : {}),
        state: { $in: ['NEW', 'PROCESSING', 'PENDING', 'UNKNOWN'] },
        leaseUntil: { $lte: new Date() },
        nextCheckAt: { $lte: new Date() },
        attempts: { $lt: 12 },
      },
      {
        $set: { leaseUntil: new Date(Date.now() + 60000), state: 'PROCESSING' },
        $inc: { attempts: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!record) return;
    try {
      const capture = await captures.findOne({ _id: record.captureId });
      if (!capture) throw new HttpError(409, 'CAPTURE_NOT_FOUND', 'Capture not found');
      if (
        !record.providerId &&
        record.mode !== 'development' &&
        Date.now() - Date.parse(record.createdAt) > 20 * 3600000
      )
        throw new HttpError(
          409,
          'IDEMPOTENCY_WINDOW_EXPIRED',
          'Refund needs provider reconciliation',
        );
      const proof: ProviderRefund =
        record.mode === 'development'
          ? {
              id: `devref_${record._id.replaceAll('-', '')}`,
              state: 'PROCESSED',
              amountMinor: record.amountMinor,
              paymentRef: capture.paymentRef,
              currency: 'INR',
            }
          : record.providerId
            ? await gateways.fetchRefund(
                record.gateway,
                record.providerId,
                capture.paymentRef,
                record.amountMinor,
              )
            : await gateways.refund(
                record.gateway,
                capture.paymentRef,
                record.amountMinor,
                record._id,
              );
      await applyRefund(record, proof);
    } catch (error) {
      await refunds.updateOne(
        { _id: record._id, state: { $ne: 'PROCESSED' } },
        {
          $set: {
            state: 'UNKNOWN',
            lastError: error instanceof HttpError ? error.code : 'REFUND_RESULT_UNKNOWN',
          },
        },
      );
    } finally {
      await refunds.updateOne(
        { _id: record._id },
        {
          $set: {
            leaseUntil: new Date(0),
            nextCheckAt: new Date(Date.now() + Math.min(60000, 2000 * 2 ** record.attempts)),
            updatedAt: new Date().toISOString(),
          },
        },
      );
    }
  }
  async function deliverRefund() {
    const record = await refunds.findOneAndUpdate(
      {
        mode: config.COMMERCE_MODE,
        state: 'PROCESSED',
        source: 'ORDER',
        acknowledged: false,
        leaseUntil: { $lte: new Date() },
        nextCheckAt: { $lte: new Date() },
      },
      { $set: { leaseUntil: new Date(Date.now() + 30000) } },
      { returnDocument: 'after' },
    );
    if (!record) return;
    try {
      await internalCall(ctx, 'restaurant', '/internal/v1/orders/refund-applied', {
        orderId: record.orderId,
        refundId: record._id,
        amountMinor: record.amountMinor,
      });
      await refunds.updateOne(
        { _id: record._id },
        { $set: { acknowledged: true, leaseUntil: new Date(0) } },
      );
    } catch {
      await refunds.updateOne(
        { _id: record._id },
        { $set: { leaseUntil: new Date(0), nextCheckAt: new Date(Date.now() + 5000) } },
      );
    }
  }
  async function processInbox() {
    const record = await inbox.findOneAndUpdate(
      {
        mode: config.COMMERCE_MODE,
        state: { $in: ['NEW', 'UNMATCHED'] },
        attempts: { $lt: 8 },
        leaseUntil: { $lte: new Date() },
        nextCheckAt: { $lte: new Date() },
      },
      { $set: { leaseUntil: new Date(Date.now() + 60000) }, $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
    if (!record) return;
    try {
      let attempt = record.attemptId
        ? await attempts.findOne({
            _id: record.attemptId,
            gateway: record.gateway,
            mode: config.COMMERCE_MODE,
          })
        : record.providerId
          ? await attempts.findOne({
              providerId: record.providerId,
              gateway: record.gateway,
              mode: config.COMMERCE_MODE,
            })
          : null;
      if (record.refundRef) {
        const refund = await refunds.findOne({
          gateway: record.gateway,
          providerId: record.refundRef,
        });
        if (refund) {
          await refunds.updateOne(
            { _id: refund._id },
            { $set: { nextCheckAt: new Date(0), leaseUntil: new Date(0) } },
          );
          await processRefund(refund._id);
          attempt = await attempts.findOne({ _id: refund.attemptId });
        }
      }
      if (!attempt && record.paymentRef) {
        const capture = await captures.findOne({
          gateway: record.gateway,
          paymentRef: record.paymentRef,
        });
        if (capture) attempt = await attempts.findOne({ _id: capture.attemptId });
      }
      if (!attempt)
        throw new HttpError(404, 'UNMATCHED_EVENT', 'Provider event has no known payment attempt');
      if (!attempt.providerId && record.providerId) {
        await gateways.verifyReference(attempt.payable, record.providerId);
        await attempts.updateOne(
          { _id: attempt._id },
          { $set: { providerId: record.providerId, state: 'READY' } },
        );
      }
      await reconcileAttempt(attempt._id);
      await deliverCapture(attempt._id);
      await inbox.updateOne(
        { _id: record._id },
        { $set: { state: 'APPLIED', leaseUntil: new Date(0), lastError: null } },
      );
    } catch (error) {
      await inbox.updateOne(
        { _id: record._id },
        {
          $set: {
            state: 'UNMATCHED',
            leaseUntil: new Date(0),
            nextCheckAt: new Date(Date.now() + 30000),
            lastError: error instanceof HttpError ? error.code : 'PROCESSING_UNAVAILABLE',
          },
        },
      );
    }
  }
  const router = express.Router();
  router.use(async (_req, _res, next) => {
    try {
      await ready();
      next();
    } catch (error) {
      next(error);
    }
  });
  router.get('/capabilities', (_req, res) => json(res, gatewayCapabilities(config)));
  router.post('/attempts', remoteSession(ctx, { mutation: true }), async (req, res) => {
    const input = z.object({ orderId: z.string().uuid() }).strict().parse(req.body),
      record = await ensureAttempt(
        input.orderId,
        currentPrincipal(res).userId,
        requireIdempotency(req),
      );
    await createProvider(record._id);
    json(res, present((await attempts.findOne({ _id: record._id }))!), 201);
  });
  router.get('/attempts/:attemptId', remoteSession(ctx), async (req, res) =>
    json(res, present(await owned(checkedId(req.params.attemptId), currentPrincipal(res).userId))),
  );
  router.post(
    '/attempts/:attemptId/verify',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      const record = await owned(checkedId(req.params.attemptId), currentPrincipal(res).userId);
      if (record.gateway === 'razorpay' && record.mode !== 'development') {
        const body = z
          .object({
            paymentId: z.string().min(1).max(150),
            signature: z.string().regex(/^[0-9a-f]{64}$/),
          })
          .strict()
          .parse(req.body);
        if (!record.providerId)
          throw new HttpError(409, 'PROVIDER_PENDING', 'Provider creation is pending');
        gateways.verifyReturn(record.providerId, body.paymentId, body.signature);
      } else z.object({}).strict().parse(req.body);
      await reconcileAttempt(record._id);
      await deliverCapture(record._id);
      json(res, present((await attempts.findOne({ _id: record._id }))!));
    },
  );
  router.post(
    '/attempts/:attemptId/simulate',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      if (
        config.COMMERCE_MODE !== 'development' ||
        config.NODE_ENV === 'production' ||
        config.DEV_ADAPTERS !== 'true'
      )
        throw new HttpError(404, 'NOT_FOUND', 'Simulator unavailable');
      const input = z
          .object({ outcome: z.enum(['captured', 'failed']) })
          .strict()
          .parse(req.body),
        record = await owned(checkedId(req.params.attemptId), currentPrincipal(res).userId);
      if (record.mode !== 'development' || !record.providerId)
        throw new HttpError(409, 'PAYMENT_NOT_READY', 'Test payment is not ready');
      if (input.outcome === 'captured')
        await recordCapture(record, {
          paymentRef: `devpay_${record._id.replaceAll('-', '')}`,
          amountMinor: record.amountMinor,
          currency: 'INR',
        });
      else
        await attempts.updateOne(
          { _id: record._id, state: { $ne: 'CAPTURED' } },
          {
            $set: {
              lastError: 'DEVELOPMENT_PAYMENT_DECLINED',
              updatedAt: new Date().toISOString(),
            },
          },
        );
      await deliverCapture(record._id);
      json(res, present((await attempts.findOne({ _id: record._id }))!));
    },
  );
  app.use('/api/v1/payments', router);
  app.get('/api/v1/refunds', remoteSession(ctx), async (req, res) => {
    await ready();
    const query = z.object({ orderId: z.string().uuid().optional() }).strict().parse(req.query);
    json(
      res,
      (
        await refunds
          .find({
            userId: currentPrincipal(res).userId,
            ...(query.orderId ? { orderId: query.orderId } : {}),
          })
          .sort({ createdAt: -1 })
          .limit(100)
          .toArray()
      ).map(presentRefund),
    );
  });
  app.post('/api/v1/webhooks/:gateway', async (req, res) => {
    await ready();
    const gateway = z.enum(['razorpay', 'stripe']).parse(req.params.gateway);
    if (!Buffer.isBuffer(req.body))
      throw new HttpError(400, 'RAW_BODY_REQUIRED', 'Webhook raw bytes are required');
    const hint = verifyWebhook(
        gateway,
        req.body,
        {
          'stripe-signature': req.get('stripe-signature'),
          'x-razorpay-signature': req.get('x-razorpay-signature'),
          'x-razorpay-event-id': req.get('x-razorpay-event-id'),
        },
        config,
      ),
      id = `${config.COMMERCE_MODE}:${gateway}:${hint.eventId}`;
    try {
      await inbox.insertOne({
        _id: id,
        ...hint,
        mode: config.COMMERCE_MODE,
        gateway,
        state: 'NEW',
        attempts: 0,
        nextCheckAt: new Date(0),
        leaseUntil: new Date(0),
        receivedAt: new Date().toISOString(),
        lastError: null,
      });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000))
        throw error;
      const existing = await inbox.findOne({ _id: id });
      if (existing && existing.bodyHash !== hint.bodyHash)
        throw new HttpError(409, 'EVENT_ID_CONFLICT', 'Event ID was reused with different bytes');
    }
    json(res, { received: true });
  });
  async function actor(sessionId: string, write = false) {
    const principal = await internalCall<import('@cravecart/contracts').Principal>(
      ctx,
      'auth',
      '/internal/v1/sessions/inspect',
      { sessionId },
    );
    requirePermission(principal, write ? 'finance:write' : 'finance:read', write);
    return principal;
  }
  const internal = express.Router();
  internal.use(internalOnly(ctx, ['restaurant', 'admin']));
  internal.use(async (_req, _res, next) => {
    try {
      await ready();
      next();
    } catch (error) {
      next(error);
    }
  });
  internal.post('/payments/capabilities', (_req, res) => json(res, gatewayCapabilities(config)));
  internal.post('/payments/reconcile-order', async (req, res) => {
    if (res.locals.caller !== 'restaurant')
      throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const { orderId } = z.object({ orderId: z.string().uuid() }).strict().parse(req.body),
      record = await attempts.findOne({ orderId });
    if (record) {
      await reconcileAttempt(record._id);
      await deliverCapture(record._id);
      await deliverRefund();
    }
    json(res, { checked: true });
  });
  internal.post('/refunds/authorize', async (req, res) => {
    if (res.locals.caller !== 'restaurant')
      throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({
        refundId: z.string().uuid(),
        orderId: z.string().uuid(),
        attemptId: z.string().uuid(),
        userId: z.string().uuid(),
        amountMinor: z.number().int().positive(),
        reason: z.string().min(5).max(500),
      })
      .strict()
      .parse(req.body);
    json(res, await reserveRefund(input, 'ORDER'), 202);
  });
  async function report() {
    const groups = await ledger
      .find({ mode: config.COMMERCE_MODE })
      .sort({ at: -1 })
      .limit(100)
      .toArray();
    const balances = await ledger
      .aggregate([
        { $match: { mode: config.COMMERCE_MODE } },
        { $unwind: '$entries' },
        {
          $group: {
            _id: { mode: '$mode', currency: '$currency', account: '$entries.account' },
            debitMinor: { $sum: '$entries.debitMinor' },
            creditMinor: { $sum: '$entries.creditMinor' },
          },
        },
        {
          $group: {
            _id: { mode: '$_id.mode', currency: '$_id.currency' },
            debitMinor: { $sum: '$debitMinor' },
            creditMinor: { $sum: '$creditMinor' },
            accounts: {
              $push: { k: '$_id.account', v: { $subtract: ['$debitMinor', '$creditMinor'] } },
            },
          },
        },
        {
          $project: {
            _id: 0,
            mode: '$_id.mode',
            currency: '$_id.currency',
            debitMinor: 1,
            creditMinor: 1,
            accounts: { $arrayToObject: '$accounts' },
            balanced: { $eq: ['$debitMinor', '$creditMinor'] },
          },
        },
      ])
      .toArray();
    const unbalancedGroups = await ledger.countDocuments({
      mode: config.COMMERCE_MODE,
      $expr: { $ne: [{ $sum: '$entries.debitMinor' }, { $sum: '$entries.creditMinor' }] },
    });
    const missingCaptures = await captures
      .aggregate([
        { $match: { mode: config.COMMERCE_MODE } },
        {
          $lookup: {
            from: 'ledger',
            let: { key: { $concat: ['capture:', '$_id'] } },
            pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$key'] } } }],
            as: 'posting',
          },
        },
        { $match: { posting: { $size: 0 } } },
        { $count: 'count' },
      ])
      .toArray();
    const missingRefunds = await refunds
      .aggregate([
        { $match: { mode: config.COMMERCE_MODE, state: 'PROCESSED' } },
        {
          $lookup: {
            from: 'ledger',
            let: { key: { $concat: ['refund:', '$_id'] } },
            pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$key'] } } }],
            as: 'posting',
          },
        },
        { $match: { posting: { $size: 0 } } },
        { $count: 'count' },
      ])
      .toArray();
    const missingPostingGroups =
      Number(missingCaptures[0]?.count ?? 0) + Number(missingRefunds[0]?.count ?? 0);
    const overRefundedCaptures = await captures.countDocuments({
      mode: config.COMMERCE_MODE,
      $expr: {
        $or: [
          { $gt: ['$refundedMinor', '$amountMinor'] },
          { $gt: ['$refundReservedMinor', '$amountMinor'] },
        ],
      },
    });
    return {
      mode: config.COMMERCE_MODE,
      balances,
      unbalancedGroups,
      missingPostingGroups,
      overRefundedCaptures,
      ledger: groups.slice(0, 100),
      attempts: (
        await attempts
          .find({ mode: config.COMMERCE_MODE })
          .sort({ updatedAt: -1 })
          .limit(100)
          .toArray()
      ).map((record) => ({
        id: record._id,
        orderId: record.orderId,
        gateway: record.gateway,
        mode: record.mode,
        state: record.state,
        amountMinor: record.amountMinor,
        providerId: record.providerId,
        lastError: record.lastError,
        updatedAt: record.updatedAt,
      })),
      refunds: (
        await refunds
          .find({ mode: config.COMMERCE_MODE })
          .sort({ updatedAt: -1 })
          .limit(100)
          .toArray()
      ).map(presentRefund),
      unmatchedEvents: await inbox.countDocuments({
        mode: config.COMMERCE_MODE,
        state: { $ne: 'APPLIED' },
      }),
      exceptions: await db
        .collection('finance_exceptions')
        .find({ mode: config.COMMERCE_MODE })
        .limit(100)
        .toArray(),
      jobs: await db
        .collection('reconciliation_jobs')
        .find({ mode: config.COMMERCE_MODE })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray(),
      scope:
        'Balances cover all posting groups in the current environment; lists show the most recent 100 records.',
    };
  }
  internal.post('/finance/refund-read', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({ actorSessionId: z.string().uuid(), refundId: z.string().uuid() })
      .strict()
      .parse(req.body);
    await actor(input.actorSessionId);
    const refund = await refunds.findOne({ _id: input.refundId, mode: config.COMMERCE_MODE });
    if (!refund) throw new HttpError(404, 'REFUND_NOT_FOUND', 'Refund not found');
    json(res, presentRefund(refund));
  });
  internal.post('/finance/attach-refund-reference', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({
        actorSessionId: z.string().uuid(),
        refundId: z.string().uuid(),
        providerId: z
          .string()
          .regex(/^[A-Za-z0-9_]+$/)
          .max(180),
        reason: z.string().min(5).max(500),
      })
      .strict()
      .parse(req.body);
    const principal = await actor(input.actorSessionId, true);
    const refund = await refunds.findOne({
      _id: input.refundId,
      mode: config.COMMERCE_MODE,
      state: 'UNKNOWN',
      providerId: null,
    });
    if (!refund) throw new HttpError(409, 'REFERENCE_LOCKED', 'Refund cannot be linked');
    const capture = await captures.findOne({ _id: refund.captureId });
    if (!capture) throw new HttpError(409, 'CAPTURE_MISSING', 'Capture is unavailable');
    await gateways.fetchRefund(
      refund.gateway,
      input.providerId,
      capture.paymentRef,
      refund.amountMinor,
    );
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const linked = await refunds.updateOne(
          { _id: refund._id, state: 'UNKNOWN', providerId: null },
          { $set: { providerId: input.providerId, attempts: 0, nextCheckAt: new Date(0) } },
          { session },
        );
        if (!linked.modifiedCount)
          throw new HttpError(409, 'REFERENCE_LOCKED', 'Refund changed during reconciliation');
        await db.collection('finance_audit').insertOne(
          {
            actorId: principal.userId,
            action: 'refund-reference-linked',
            refundId: refund._id,
            providerId: input.providerId,
            reason: input.reason,
            at: new Date(),
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    json(res, { linked: true });
  });
  internal.post('/finance/report', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    await actor(
      z.object({ actorSessionId: z.string().uuid() }).strict().parse(req.body).actorSessionId,
    );
    json(res, await report());
  });
  internal.post('/finance/reconcile', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
        .object({ actorSessionId: z.string().uuid(), reason: z.string().min(5).max(500) })
        .strict()
        .parse(req.body),
      principal = await actor(input.actorSessionId, true),
      ids = (
        await attempts
          .find({ mode: config.COMMERCE_MODE })
          .sort({ nextCheckAt: 1 })
          .limit(50)
          .toArray()
      ).map((record) => record._id),
      id = randomUUID();
    await db
      .collection<{
        _id: string;
        ids: string[];
        processed: number;
        state: string;
        mode: CommerceMode;
        reason: string;
        actorId: string;
        createdAt: string;
      }>('reconciliation_jobs')
      .insertOne({
        _id: id,
        ids,
        mode: config.COMMERCE_MODE,
        processed: 0,
        state: ids.length ? 'PENDING' : 'COMPLETED',
        reason: input.reason,
        actorId: principal.userId,
        createdAt: new Date().toISOString(),
      });
    await attempts.updateMany({ _id: { $in: ids } }, { $set: { nextCheckAt: new Date(0) } });
    await refunds.updateMany(
      { mode: config.COMMERCE_MODE, state: { $in: ['NEW', 'UNKNOWN', 'PENDING', 'PROCESSING'] } },
      { $set: { attempts: 0, nextCheckAt: new Date(0) } },
    );
    await inbox.updateMany(
      { mode: config.COMMERCE_MODE, state: 'UNMATCHED' },
      { $set: { attempts: 0, nextCheckAt: new Date(0) } },
    );
    json(res, { jobId: id, state: ids.length ? 'PENDING' : 'COMPLETED' }, 202);
  });
  internal.post('/finance/attach-reference', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
        .object({
          actorSessionId: z.string().uuid(),
          attemptId: z.string().uuid(),
          providerId: z
            .string()
            .regex(/^[A-Za-z0-9_]+$/)
            .max(180),
          reason: z.string().min(5).max(500),
        })
        .strict()
        .parse(req.body),
      principal = await actor(input.actorSessionId, true),
      record = await attempts.findOne({
        _id: input.attemptId,
        state: 'UNKNOWN',
        providerId: null,
        mode: config.COMMERCE_MODE,
      });
    if (!record)
      throw new HttpError(
        409,
        'REFERENCE_LOCKED',
        'Only an unresolved attempt without a provider reference can be linked',
      );
    await gateways.verifyReference(record.payable, input.providerId);
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const changed = await attempts.updateOne(
          { _id: record._id, state: 'UNKNOWN', providerId: null },
          {
            $set: {
              providerId: input.providerId,
              state: 'READY',
              lastError: null,
              nextCheckAt: new Date(0),
            },
          },
          { session },
        );
        if (!changed.modifiedCount) throw new HttpError(409, 'REFERENCE_LOCKED', 'Attempt changed');
        await db.collection('finance_audit').insertOne(
          {
            id: randomUUID(),
            actorId: principal.userId,
            attemptId: record._id,
            providerId: input.providerId,
            reason: input.reason,
            action: 'provider-reference-linked',
            at: new Date(),
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    json(res, { linked: true });
  });
  app.use('/internal/v1', internal);
  let busy = false,
    work: Promise<void> | undefined;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await ready();
      if (config.COMMERCE_MODE === 'disabled') return;
      const attempt = await attempts.findOne({
        mode: config.COMMERCE_MODE,
        leaseUntil: { $lte: new Date() },
        nextCheckAt: { $lte: new Date() },
      });
      if (attempt) await reconcileAttempt(attempt._id);
      await processInbox();
      await deliverCapture();
      await processRefund();
      await deliverRefund();
      const job = await db
        .collection<{
          _id: string;
          ids: string[];
          processed: number;
          state: string;
          mode: CommerceMode;
        }>('reconciliation_jobs')
        .findOne({ state: 'PENDING', mode: config.COMMERCE_MODE });
      if (job) {
        const id = job.ids[job.processed];
        if (id) await reconcileAttempt(id);
        await db
          .collection<{ _id: string; processed: number; state: string }>('reconciliation_jobs')
          .updateOne(
            { _id: job._id, processed: job.processed },
            {
              $inc: { processed: 1 },
              $set: { state: job.processed + 1 >= job.ids.length ? 'COMPLETED' : 'PENDING' },
            },
          );
      }
    } catch {
      /* Durable work remains visible for retry and operator reconciliation. */
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(() => {
    work = tick();
  }, 3000);
  timer.unref();
  ctx.onClose?.(async () => {
    clearInterval(timer);
    await work;
  });
  return {
    tick,
    recordCapture,
    reconcileAttempt,
    deliverCapture,
    processRefund,
    deliverRefund,
    processInbox,
    report,
  };
}
