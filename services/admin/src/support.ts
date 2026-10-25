import type { Express } from 'express';
import express from 'express';
import { z } from 'zod';
import type { Principal } from '@cravecart/contracts';
import { randomUUID } from 'node:crypto';
import {
  ticketInputSchema,
  messageInputSchema,
  ticketActionSchema,
  pageQuerySchema,
  type SupportTicket,
  type OperationMessage,
} from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  requireIdempotency,
  internalCall,
  checkedId,
  HttpError,
  json,
  lazyIndexes,
  internalOnly,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce } from '@cravecart/persistence';
type Ticket = SupportTicket & { _id: string };
type Message = OperationMessage & { _id: string; ticketId: string };
export function installSupport(app: Express, ctx: DomainContext) {
  const { db, client } = ctx,
    tickets = db.collection<Ticket>('support_tickets'),
    messages = db.collection<Message>('support_messages');
  const ready = lazyIndexes(async () => {
    await tickets.createIndex({ requesterId: 1, updatedAt: -1 });
    await tickets.createIndex({ state: 1, updatedAt: -1 });
    await messages.createIndex({ ticketId: 1, sequence: 1 }, { unique: true });
    await db.collection('support_limits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  });
  async function quota(userId: string, kind: string, max: number) {
    await ready();
    const hour = Math.floor(Date.now() / 3600000);
    const row = await db
      .collection('support_limits')
      .findOneAndUpdate(
        { _id: (userId + ':' + kind + ':' + hour) as never },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + 7200000) } },
        { upsert: true, returnDocument: 'after' },
      );
    if (row!.count > max)
      throw new HttpError(
        429,
        'SUPPORT_RATE_LIMIT',
        'Please wait before sending more support requests',
      );
  }
  const present = ({ _id: _id, ...value }: Ticket) => value;
  const publicMessage = ({ _id: _id, ticketId: _t, ...value }: Message) => value;
  async function createTicket(input:ReturnType<typeof ticketInputSchema.parse>,userId:string,key:string,expiresAt?:string){
    await quota(userId,'create',10);
    return executeOnce(client,db,userId+':ticket',key,{...input,...(expiresAt?{expiresAt}:{})},async(session)=>{
      if(expiresAt&&Date.parse(expiresAt)<=Date.now())throw new HttpError(409,'ACTION_EXPIRED','Review a new support proposal');
      const now=new Date().toISOString(),id=randomUUID(),ticket:Ticket={_id:id,id,requesterId:userId,subject:input.subject,category:input.category,orderId:input.orderId,state:'OPEN',version:1,assignedTo:null,createdAt:now,updatedAt:now,resolution:null};
      await tickets.insertOne(ticket,{session});const mid=randomUUID();await messages.insertOne({_id:mid,id:mid,ticketId:id,sequence:1,author:'requester',text:input.text,at:now},{session});return present(ticket);
    });
  }
  for (const admin of [false, true]) {
    const router = express.Router(),
      base = admin ? '/api/v1/admin/support/tickets' : '/api/v1/support/tickets';
    router.use(remoteSession(ctx, admin ? { permission: 'support:read' } : {}));
    router.get('/', async (req, res) => {
      await ready();
      const { page } = pageQuerySchema.parse(req.query),
        filter = admin ? {} : { requesterId: currentPrincipal(res).userId };
      json(res, {
        tickets: (
          await tickets
            .find(filter)
            .sort({ updatedAt: -1, _id: -1 })
            .skip((page - 1) * 25)
            .limit(25)
            .toArray()
        ).map(present),
        total: await tickets.countDocuments(filter),
        page,
      });
    });
    if (!admin)
      router.post('/', remoteSession(ctx, { mutation: true }), async (req, res) => {
        const input = ticketInputSchema.parse(req.body),
          actor = currentPrincipal(res);
        if (input.orderId)
          await internalCall(ctx, 'restaurant', '/internal/v1/operations/order-context', {
            sessionId: actor.sessionId,
            orderId: input.orderId,
          });
        const key = requireIdempotency(req);
        json(
          res,
          await createTicket(input,actor.userId,key),
          201,
        );
      });
    async function owned(id: string, userId: string) {
      const ticket = await tickets.findOne({ _id: id, ...(admin ? {} : { requesterId: userId }) });
      if (!ticket) throw new HttpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found');
      return ticket;
    }
    router.get('/:ticketId', async (req, res) => {
      const ticket = await owned(checkedId(req.params.ticketId), currentPrincipal(res).userId),
        { page } = pageQuerySchema.parse(req.query);
      json(res, {
        ticket: present(ticket),
        messages: (
          await messages
            .find({ ticketId: ticket.id })
            .sort({ sequence: 1 })
            .skip((page - 1) * 50)
            .limit(50)
            .toArray()
        ).map(publicMessage),
        total: await messages.countDocuments({ ticketId: ticket.id }),
        page,
      });
    });
    router.post(
      '/:ticketId/messages',
      remoteSession(
        ctx,
        admin ? { permission: 'support:write', mutation: true } : { mutation: true },
      ),
      async (req, res) => {
        const input = messageInputSchema.parse(req.body),
          actor = currentPrincipal(res),
          id = checkedId(req.params.ticketId);
        await owned(id, actor.userId);
        await quota(actor.userId, 'messages', 60);
        json(
          res,
          await executeOnce(
            client,
            db,
            actor.userId + ':ticket-message:' + id,
            requireIdempotency(req),
            input,
            async (session) => {
              const ticket = await tickets.findOne(
                { _id: id, ...(admin ? {} : { requesterId: actor.userId }) },
                { session },
              );
              if (!ticket) throw new HttpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found');
              if (ticket.version !== input.expectedVersion)
                throw new HttpError(
                  409,
                  'VERSION_CONFLICT',
                  'New support updates arrived; reload before replying',
                );
              if (ticket.state === 'CLOSED')
                throw new HttpError(
                  409,
                  'TICKET_CLOSED',
                  'This conversation is closed. Create a new ticket if needed',
                );
              const now = new Date().toISOString(),
                mid = randomUUID(),
                message: Message = {
                  _id: mid,
                  id: mid,
                  ticketId: id,
                  sequence: ticket.version + 1,
                  author: admin ? 'agent' : 'requester',
                  text: input.text,
                  at: now,
                };
              await tickets.updateOne(
                { _id: id },
                {
                  $set: {
                    state: admin ? 'AWAITING_CUSTOMER' : 'OPEN',
                    updatedAt: now,
                    resolution: null,
                    ...(admin ? { assignedTo: actor.userId } : {}),
                  },
                  $inc: { version: 1 },
                },
                { session },
              );
              await messages.insertOne(message, { session });
              return publicMessage(message);
            },
          ),
          201,
        );
      },
    );
    router.post(
      '/:ticketId/state',
      remoteSession(
        ctx,
        admin ? { permission: 'support:write', stepUp: true, mutation: true } : { mutation: true },
      ),
      async (req, res) => {
        const input = ticketActionSchema.parse(req.body),
          actor = currentPrincipal(res),
          id = checkedId(req.params.ticketId);
        await owned(id, actor.userId);
        if (!admin && input.state !== 'CLOSED')
          throw new HttpError(403, 'FORBIDDEN', 'Customers can close their own ticket');
        json(
          res,
          await executeOnce(
            client,
            db,
            actor.userId + ':ticket-state:' + id,
            requireIdempotency(req),
            input,
            async (session) => {
              const ticket = await tickets.findOne(
                { _id: id, ...(admin ? {} : { requesterId: actor.userId }) },
                { session },
              );
              if (!ticket) throw new HttpError(404, 'TICKET_NOT_FOUND', 'Support ticket not found');
              if (ticket.version !== input.expectedVersion)
                throw new HttpError(409, 'VERSION_CONFLICT', 'Ticket changed; reload');
              if (ticket.state === 'CLOSED')
                throw new HttpError(409, 'TICKET_CLOSED', 'Closed tickets cannot be reopened');
              const now = new Date().toISOString(),
                next = {
                  ...ticket,
                  state: input.state,
                  version: ticket.version + 1,
                  updatedAt: now,
                  resolution: ['RESOLVED', 'CLOSED'].includes(input.state) ? input.reason : null,
                  ...(admin ? { assignedTo: actor.userId } : {}),
                };
              await tickets.replaceOne({ _id: id }, next, { session });
              const mid = randomUUID();
              await messages.insertOne(
                {
                  _id: mid,
                  id: mid,
                  ticketId: id,
                  sequence: next.version,
                  author: admin ? 'agent' : 'requester',
                  text: input.reason,
                  at: now,
                },
                { session },
              );
              await db.collection('audit').insertOne(
                {
                  id: randomUUID(),
                  action: 'support.state',
                  actorId: actor.userId,
                  reason: input.reason,
                  before: ticket.state,
                  after: next.state,
                  ticketId: id,
                  at: now,
                  requestId: res.locals.requestId,
                },
                { session },
              );
              return present(next);
            },
          ),
        );
      },
    );
    app.use(base, router);
  }
  const assistant=express.Router();assistant.use(internalOnly(ctx,['utils']));
  assistant.post('/preview',async(req,res)=>{
    const input=z.object({sessionId:z.string().uuid(),ticket:ticketInputSchema}).strict().parse(req.body);
    await internalCall(ctx,'auth','/internal/v1/sessions/inspect',{sessionId:input.sessionId});
    if(input.ticket.orderId)await internalCall(ctx,'restaurant','/internal/v1/operations/order-context',{sessionId:input.sessionId,orderId:input.ticket.orderId});
    json(res,{valid:true});
  });
  assistant.post('/create',async(req,res)=>{
    const input=z.object({sessionId:z.string().uuid(),commandId:z.string().uuid(),expiresAt:z.string().datetime(),ticket:ticketInputSchema}).strict().parse(req.body),actor=await internalCall<Principal>(ctx,'auth','/internal/v1/sessions/inspect',{sessionId:input.sessionId});
    if(ctx.config.ASSISTANT_WRITES_ENABLED!=='true'||ctx.config.ASSISTANT_WRITES_REVIEWED!=='true')throw new HttpError(503,'ASSISTANT_WRITES_DISABLED','Assistant handoff actions are not enabled');
    if(input.ticket.orderId)await internalCall(ctx,'restaurant','/internal/v1/operations/order-context',{sessionId:input.sessionId,orderId:input.ticket.orderId});
    const result=await createTicket(input.ticket,actor.userId,input.commandId,input.expiresAt);json(res,{applied:true,href:'/support/tickets/'+result.id});
  });
  app.use('/internal/v1/assistant-support',assistant);
}
