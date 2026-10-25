import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import type { ClientSession, Collection } from 'mongodb';
import { z } from 'zod';
import {
  financialApprovalSchema,
  financialApprovalDecisionSchema,
  financialApprovalQuerySchema,
  type FinancialApproval,
  type Order,
  type Principal,
} from '@cravecart/contracts';
import {
  internalCall,
  HttpError,
  json,
  lazyIndexes,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce } from '@cravecart/persistence';
import type { OrderRecord } from './orders.js';

interface Record extends Omit<FinancialApproval, 'id' | 'expiresAt'> {
  _id: string;
  expiresAt: Date;
  requesterSessionId: string;
}
interface Ops {
  orders: Collection<OrderRecord>;
  verifyAdmin: (sessionId: string, write?: boolean) => Promise<Principal>;
  present: (order: OrderRecord) => Order;
  authorizeRefund: (
    order: OrderRecord,
    amount: number,
    reason: string,
    session: ClientSession,
  ) => Promise<string>;
}
export function installFinancialApprovals(router: Router, ctx: DomainContext, ops: Ops) {
  const { db, client, config } = ctx;
  const approvals = db.collection<Record>('financial_approvals');
  const ready = lazyIndexes(async () => {
    await approvals.createIndex({ mode: 1, requestedAt: -1, _id: -1 });
  });
  function present(record: Record): FinancialApproval {
    const { _id, requesterSessionId: _session, expiresAt, ...value } = record;
    return financialApprovalSchema.parse({
      ...value,
      id: _id,
      expiresAt: expiresAt.toISOString(),
      status: value.status === 'PENDING' && expiresAt <= new Date() ? 'EXPIRED' : value.status,
    });
  }
  async function propose(
    order: OrderRecord,
    principal: Principal,
    amountMinor: number,
    reason: string,
    session: ClientSession,
    correlationId: string,
  ) {
    if (
      amountMinor <= 0 ||
      order.refundRequestedMinor + amountMinor > order.quote.totals.totalMinor
    )
      throw new HttpError(409, 'REFUND_LIMIT', 'Refunds cannot exceed the captured order amount');
    if (order.refundRequestedMinor + amountMinor < config.FINANCE_DUAL_APPROVAL_THRESHOLD_MINOR)
      return null;
    const record: Record = {
      _id: randomUUID(),
      orderId: order.id,
      orderNumber: order.number,
      orderVersion: order.version,
      amountMinor,
      reason,
      requestedBy: principal.userId,
      requesterSessionId: principal.sessionId,
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60_000),
      status: 'PENDING',
      version: 1,
      reviewedBy: null,
      reviewReason: null,
      reviewedAt: null,
      refundId: null,
      thresholdMinor: config.FINANCE_DUAL_APPROVAL_THRESHOLD_MINOR,
      mode: order.quote.mode,
    };
    await approvals.insertOne(record, { session });
    await db.collection('commerce_audit').insertOne(
      {
        id: randomUUID(),
        actorId: principal.userId,
        action: 'refund.approval.requested',
        approvalId: record._id,
        orderId: order.id,
        amountMinor,
        reason,
        thresholdMinor: record.thresholdMinor,
        mode: record.mode,
        correlationId,
        before: { orderVersion: order.version, refundRequestedMinor: order.refundRequestedMinor },
        after: { approvalStatus: 'PENDING', refundRequestedMinor: order.refundRequestedMinor },
        at: new Date(),
      },
      { session },
    );
    return present(record);
  }
  router.post('/orders/financial-approvals/list', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const { actorSessionId, ...query } = z
      .object({ actorSessionId: z.string().uuid(), ...financialApprovalQuerySchema.shape })
      .strict()
      .parse(req.body);
    await ops.verifyAdmin(actorSessionId, false);
    await ready();
    const filter = { mode: config.COMMERCE_MODE };
    json(res, {
      approvals: (
        await approvals
          .find(filter)
          .sort({ requestedAt: -1, _id: -1 })
          .skip((query.page - 1) * 20)
          .limit(20)
          .toArray()
      ).map(present),
      total: await approvals.countDocuments(filter),
      page: query.page,
      pageSize: 20,
      thresholdMinor: config.FINANCE_DUAL_APPROVAL_THRESHOLD_MINOR,
    });
  });
  router.post('/orders/financial-approvals/decide', async (req, res) => {
    if (res.locals.caller !== 'admin') throw new HttpError(403, 'SERVICE_DENIED', 'Service denied');
    const input = z
      .object({
        actorSessionId: z.string().uuid(),
        approvalId: z.string().uuid(),
        commandId: z.string().min(16),
        ...financialApprovalDecisionSchema.shape,
      })
      .strict()
      .parse(req.body);
    const principal = await ops.verifyAdmin(input.actorSessionId);
    await ready();
    const initial = await approvals.findOne({ _id: input.approvalId, mode: config.COMMERCE_MODE });
    if (!initial) throw new HttpError(404, 'NOT_FOUND', 'Financial approval not found');
    if (initial.requestedBy === principal.userId)
      throw new HttpError(
        403,
        'SELF_APPROVAL_DENIED',
        'A different authorized finance account must review this request',
      );
    if (input.decision === 'approve' && initial.status === 'PENDING') {
      let requester: Principal;
      try {
        requester = await internalCall<Principal>(ctx, 'auth', '/internal/v1/sessions/inspect', {
          sessionId: initial.requesterSessionId,
        });
      } catch (error) {
        if (error instanceof HttpError && error.status >= 500)
          throw new HttpError(
            503,
            'AUTHORITY_UNAVAILABLE',
            'Finance authority could not be checked. Retry this request when identity service recovers.',
          );
        throw new HttpError(
          409,
          'REQUESTER_UNAVAILABLE',
          'The requesting account or session changed. Submit a new request.',
        );
      }
      if (
        requester.userId !== initial.requestedBy ||
        !requester.roles.includes('admin') ||
        !requester.permissions.includes('finance:write')
      )
        throw new HttpError(
          409,
          'REQUESTER_UNAVAILABLE',
          'The requesting account no longer has finance authority',
        );
    }
    const result = await executeOnce(
      client,
      db,
      `financial-review:${principal.userId}:${input.approvalId}`,
      input.commandId,
      { expectedVersion: input.expectedVersion, decision: input.decision, reason: input.reason },
      async (session) => {
        const record = await approvals.findOne(
          {
            _id: input.approvalId,
            mode: config.COMMERCE_MODE,
            version: input.expectedVersion,
            status: 'PENDING',
          },
          { session },
        );
        if (!record)
          throw new HttpError(
            409,
            'APPROVAL_CHANGED',
            'This financial request has already changed',
          );
        if (record.expiresAt <= new Date())
          throw new HttpError(
            409,
            'APPROVAL_EXPIRED',
            'This request expired. Submit a new request.',
          );
        let order: OrderRecord | null = null;
        let refundRequestedBefore: number | null = null;
        if (input.decision === 'approve') {
          order = await ops.orders.findOne(
            {
              _id: record.orderId,
              version: record.orderVersion,
              captureRef: { $type: 'string' },
              'quote.mode': record.mode,
            },
            { session },
          );
          if (!order)
            throw new HttpError(
              409,
              'ORDER_CHANGED',
              'The order changed. Review a new refund request.',
            );
          refundRequestedBefore = order.refundRequestedMinor;
          order.version++;
          record.refundId = await ops.authorizeRefund(
            order,
            record.amountMinor,
            record.reason,
            session,
          );
          await ops.orders.replaceOne({ _id: order.id }, order, { session });
        }
        record.status = input.decision === 'approve' ? 'AUTHORIZED' : 'REJECTED';
        record.version++;
        record.reviewedBy = principal.userId;
        record.reviewReason = input.reason;
        record.reviewedAt = new Date().toISOString();
        await approvals.replaceOne({ _id: record._id }, record, { session });
        await db.collection('commerce_audit').insertOne(
          {
            id: randomUUID(),
            actorId: principal.userId,
            requestedBy: record.requestedBy,
            action: `refund.approval.${record.status.toLowerCase()}`,
            approvalId: record._id,
            orderId: record.orderId,
            refundId: record.refundId,
            amountMinor: record.amountMinor,
            mode: record.mode,
            correlationId: String(res.locals.requestId ?? record.orderId),
            before: {
              approvalStatus: 'PENDING',
              approvalVersion: input.expectedVersion,
              orderVersion: record.orderVersion,
              refundRequestedMinor: refundRequestedBefore,
            },
            after: {
              approvalStatus: record.status,
              approvalVersion: record.version,
              orderVersion: order?.version ?? record.orderVersion,
              refundRequestedMinor: order?.refundRequestedMinor ?? refundRequestedBefore,
            },
            reason: input.reason,
            at: new Date(),
          },
          { session },
        );
        return { approval: present(record), order: order ? ops.present(order) : null };
      },
    );
    json(res, result, 202);
  });
  return { ready, propose };
}
