import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  assistantMessageInputSchema,
  assistantProposalInputSchema,
  assistantHandoffSchema,
  assistantConfirmSchema,
  assistantReplySchema,
  assistantMenuCardSchema,
  assistantContentInputSchema,
  type AssistantContent,
  type AssistantTurn,
  type AssistantReply,
  type AssistantAction,
  type Principal,
} from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  internalCall,
  internalOnly,
  requirePermission,
  requireIdempotency,
  checkedId,
  HttpError,
  json,
  lazyIndexes,
  seal,
  unseal,
  hash,
  opaque,
  type DomainContext,
} from '@cravecart/platform';
import { executeOnce, payloadHash } from '@cravecart/persistence';
import {
  assistantIntent,
  redactAssistantText,
  reply,
  faqAnswer,
  bundledHelp,
  safeAssistantHref,
  evaluateAssistantRouting,
  assistantVersion,
} from './assistant-engine.js';
import { createAssistantPlanner } from './assistant-provider.js';
type Conversation = {
  _id: string;
  userId: string;
  version: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  purgeAt: Date;
  turns: string;
};
type Action = {
  _id: string;
  conversationId: string;
  userId: string;
  kind: 'cart' | 'support';
  summary: string;
  expiresAt: string;
  purgeAt: Date;
  state: AssistantAction['state'];
  payload: string;
  payloadHash: string;
  tokenHash: string;
  token: string;
  resultHref: string | null;
  leaseUntil: Date;
};
type Content = AssistantContent & { _id: string; seedKey?: string };
const orderSchema = z
  .object({
    id: z.string().uuid(),
    number: z.string(),
    status: z.string(),
    paymentState: z.string(),
    version: z.number().int(),
    refundRequestedMinor: z.number().int(),
    refundedMinor: z.number().int(),
    mode: z.string(),
    checkedAt: z.string().datetime(),
  })
  .strict();
export function installAssistant(
  app: Express,
  ctx: DomainContext,
  options: { providerFetch?: typeof fetch } = {},
) {
  const { db, client, config } = ctx,
    conversations = db.collection<Conversation>('assistant_conversations'),
    actions = db.collection<Action>('assistant_actions'),
    content = db.collection<Content>('assistant_content'),
    requests = db.collection<{
      _id: string;
      userId: string;
      conversationId: string;
      digest: string;
      sealed: string;
      purgeAt: Date;
    }>('assistant_requests');
  const planner = createAssistantPlanner(ctx, options.providerFetch);
  const enc = (value: unknown) =>
    seal(Buffer.from(JSON.stringify(value)), config.AUTH_ENCRYPTION_KEY).toString('base64');
  const dec = <T>(value: string): T =>
    JSON.parse(unseal(Buffer.from(value, 'base64'), config.AUTH_ENCRYPTION_KEY).toString()) as T;
  const ready = lazyIndexes(async () => {
    await conversations.createIndex({ userId: 1, updatedAt: -1 });
    await conversations.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 });
    await actions.createIndex({ conversationId: 1, userId: 1 });
    await actions.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 });
    await requests.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 });
    await db.collection('assistant_limits').createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 });
    await db
      .collection('assistant_provider')
      .createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 });
    await db
      .collection('assistant_user_leases')
      .createIndex({ leaseUntil: 1 }, { expireAfterSeconds: 0 });
    await db
      .collection('assistant_tool_audit')
      .createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 });
    await content.createIndex({ seedKey: 1 }, { unique: true, sparse: true });
    for (const entry of bundledHelp) {
      const id = randomUUID();
      await content.updateOne(
        { seedKey: entry.topic },
        {
          $setOnInsert: {
            _id: id,
            id,
            ...entry,
            version: 1,
            status: 'PUBLISHED',
            source: 'CraveCart approved help',
            publishedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
          },
        },
        { upsert: true },
      );
    }
  });
  async function quota(userId: string, kind: string, max: number) {
    const day = new Date().toISOString().slice(0, 10),
      value = await db
        .collection('assistant_limits')
        .findOneAndUpdate(
          { _id: (userId + ':' + kind + ':' + day) as never },
          { $inc: { count: 1 }, $setOnInsert: { purgeAt: new Date(Date.now() + 2 * 86400000) } },
          { upsert: true, returnDocument: 'after' },
        );
    if (value!.count > max)
      throw new HttpError(
        429,
        'ASSISTANT_QUOTA',
        'Your assistant allowance is used for today. Search and support remain available',
      );
  }
  async function owned(id: string, userId: string) {
    await ready();
    const value = await conversations.findOne({ _id: id, userId });
    if (!value) throw new HttpError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    return value;
  }
  const publicAction = (a: Action): AssistantAction => ({
    id: a._id,
    kind: a.kind,
    summary: dec<string>(a.summary),
    expiresAt: a.expiresAt,
    state: a.state,
    confirmationToken: dec<string>(a.token),
    resultHref: a.resultHref,
  });
  async function present(c: Conversation) {
    return {
      id: c._id,
      version: c.version,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      turns: dec<AssistantTurn[]>(c.turns),
      actions: (
        await actions
          .find({ conversationId: c._id, userId: c.userId })
          .sort({ expiresAt: 1, _id: 1 })
          .limit(30)
          .toArray()
      ).map(publicAction),
    };
  }
  const writes = () => {
    if (config.ASSISTANT_WRITES_ENABLED !== 'true' || config.ASSISTANT_WRITES_REVIEWED !== 'true')
      throw new HttpError(
        503,
        'ASSISTANT_WRITES_DISABLED',
        'Assistant actions are awaiting review. Use the normal cart and support pages',
      );
  };
  app.get('/api/v1/assistant/capabilities', remoteSession(ctx), (_req, res) =>
    json(res, {
      enabled: true,
      provider: config.ASSISTANT_PROVIDER,
      writesEnabled:
        config.ASSISTANT_WRITES_ENABLED === 'true' && config.ASSISTANT_WRITES_REVIEWED === 'true',
      dailyMessages: config.ASSISTANT_DAILY_MESSAGES,
      promptVersion: assistantVersion,
    }),
  );
  app.get('/api/v1/assistant/context/orders', remoteSession(ctx), async (_req, res) =>
    json(
      res,
      await internalCall(ctx, 'restaurant', '/internal/v1/assistant-tools/read', {
        sessionId: currentPrincipal(res).sessionId,
        tool: 'orders',
      }),
    ),
  );
  app.get('/api/v1/assistant/conversations', remoteSession(ctx), async (_req, res) => {
    await ready();
    json(
      res,
      (
        await conversations
          .find({ userId: currentPrincipal(res).userId })
          .sort({ updatedAt: -1, _id: -1 })
          .limit(20)
          .toArray()
      ).map(({ _id, version, title, createdAt, updatedAt }) => ({
        id: _id,
        version,
        title,
        createdAt,
        updatedAt,
      })),
    );
  });
  app.post(
    '/api/v1/assistant/conversations',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      await ready();
      z.object({}).strict().parse(req.body);
      const actor = currentPrincipal(res);
      await quota(actor.userId, 'conversations', 10);
      const value = await executeOnce(
        client,
        db,
        actor.userId + ':assistant-create',
        requireIdempotency(req),
        {},
        async (session) => {
          const id = randomUUID(),
            now = new Date().toISOString(),
            c: Conversation = {
              _id: id,
              userId: actor.userId,
              version: 1,
              title: 'New conversation',
              createdAt: now,
              updatedAt: now,
              purgeAt: new Date(Date.now() + 30 * 86400000),
              turns: enc([]),
            };
          await conversations.insertOne(c, { session });
          return { id };
        },
      );
      json(res, await present(await owned(value.id, actor.userId)), 201);
    },
  );
  app.get('/api/v1/assistant/conversations/:conversationId', remoteSession(ctx), async (req, res) =>
    json(
      res,
      await present(
        await owned(checkedId(req.params.conversationId), currentPrincipal(res).userId),
      ),
    ),
  );
  app.delete(
    '/api/v1/assistant/conversations/:conversationId',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      const id = checkedId(req.params.conversationId),
        userId = currentPrincipal(res).userId;
      await owned(id, userId);
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          await conversations.deleteOne({ _id: id, userId }, { session });
          await actions.deleteMany({ conversationId: id, userId }, { session });
          await requests.deleteMany({ conversationId: id, userId }, { session });
        });
      } finally {
        await session.endSession();
      }
      json(res, { deleted: true });
    },
  );
  async function answer(
    text: string,
    context: { city?: string; orderId?: string },
    principal: Principal,
    signal: AbortSignal,
  ): Promise<AssistantReply> {
    let intent = assistantIntent(text),
      provider: AssistantReply['provider'] = 'builtin';
    if (intent.kind === 'unknown') {
      const plan = await planner(text, signal);
      intent = plan.intent ?? intent;
      provider = plan.provider;
    }
    if (signal.aborted) throw new HttpError(499, 'REQUEST_CANCELLED', 'Request cancelled');
    let result: AssistantReply;
    if (intent.kind === 'denied')
      result = reply(
        'DENIED',
        'I cannot access another person’s data, reveal credentials or change payments, permissions or delivery states. Use your own order and the standard verified actions.',
        [
          { label: 'Your orders', href: '/orders' },
          { label: 'Contact support', href: '/support' },
        ],
      );
    else if (intent.kind === 'safety')
      result = reply(
        'SAFETY',
        'I cannot verify whether a dish is safe for an allergy or medical dietary need. Menu allergen labels are supplied by the restaurant and do not rule out cross-contact. Check directly with the restaurant before ordering.',
        [{ label: 'Contact support', href: '/support' }],
      );
    else if (intent.kind === 'faq')
      result = faqAnswer(
        (await content.find({ status: 'PUBLISHED' }).limit(200).toArray()).map(
          ({ _id: _id, seedKey: _seed, ...c }) => c,
        ),
        intent.topic!,
        principal,
      );
    else if (intent.kind === 'menu') {
      const menu = await internalCall<{
        cards: z.infer<typeof assistantMenuCardSchema>[];
        checkedAt: string;
        city: string;
      }>(ctx, 'restaurant', '/internal/v1/assistant-tools/read', {
        sessionId: principal.sessionId,
        tool: 'menu',
        city: context.city,
        query: intent.query ?? '',
      });
      result = reply(
        'MENU',
        menu.cards.length
          ? 'Here are dishes currently listed in your selected city. Prices shown are base menu prices; choices, serviceability and the final total are checked in the cart and checkout.'
          : 'I could not find a matching listed dish in this city. Try another craving or search the restaurant directory.',
        [
          {
            label: 'Search restaurants',
            href: '/search?' + new URLSearchParams({ city: menu.city, q: intent.query ?? '' }),
          },
        ],
      );
      result.cards = menu.cards
        .map((c) => assistantMenuCardSchema.parse(c))
        .filter((c) => safeAssistantHref(c.href));
      result.sources = result.cards.slice(0, 8).map((c) => ({
        title: c.restaurantName + ' menu',
        href: c.href,
        version: null,
        checkedAt: menu.checkedAt,
      }));
    } else if (intent.kind === 'orders' || intent.kind === 'refund') {
      const ids = text.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi) ?? [],
        orderId = context.orderId ?? (ids.length === 1 ? ids[0] : undefined);
      if (ids.length > 1 || (ids.length === 1 && context.orderId && ids[0] !== context.orderId))
        return reply('DENIED', 'Choose one of your own orders and ask about that order only.', [
          { label: 'Your orders', href: '/orders' },
        ]);
      if (!orderId) {
        const orders = z.array(orderSchema).parse(
          await internalCall(ctx, 'restaurant', '/internal/v1/assistant-tools/read', {
            sessionId: principal.sessionId,
            tool: 'orders',
          }),
        );
        result = reply(
          intent.kind === 'refund' ? 'REFUND' : 'ORDER',
          orders.length
            ? 'Choose an order below or select it above, then ask for its current status or refund record.'
            : 'There are no orders for this account in the current environment.',
          orders.map((o) => ({
            label: o.number + ' · ' + o.status.replaceAll('_', ' '),
            href: '/orders/' + o.id,
          })),
        );
      } else {
        const o = orderSchema.parse(
          await internalCall(ctx, 'restaurant', '/internal/v1/assistant-tools/read', {
            sessionId: principal.sessionId,
            tool: intent.kind === 'refund' ? 'refund' : 'order',
            orderId,
          }),
        );
        const money = (n: number) => '₹' + (n / 100).toFixed(2),
          environment = ['development', 'test'].includes(o.mode)
            ? ' This is a ' +
              (o.mode === 'development' ? 'development simulator' : 'sandbox') +
              ' order.'
            : '';
        result = reply(
          intent.kind === 'refund' ? 'REFUND' : 'ORDER',
          intent.kind === 'refund'
            ? `${o.number}: payment state ${o.paymentState.replaceAll('_', ' ')}. Refund requested: ${money(o.refundRequestedMinor)}; verified refunded amount: ${money(o.refundedMinor)}. A request is not a completed bank refund; no arrival date is promised.${environment}`
            : `${o.number} is ${o.status.replaceAll('_', ' ')}. Payment state: ${o.paymentState.replaceAll('_', ' ')}. Open the order for its live timeline and available actions. I cannot promise an arrival time.${environment}`,
          [{ label: 'Open ' + o.number, href: '/orders/' + o.id }],
        );
        result.sources = [
          {
            title: 'Your verified order record',
            href: '/orders/' + o.id,
            version: o.version,
            checkedAt: o.checkedAt,
          },
        ];
      }
    } else
      result = reply(
        'HELP',
        'I can find listed dishes, explain approved help topics, and check your own order or refund record. Choose a city for food discovery, or select an order above.',
        [
          {
            label: 'Search restaurants',
            href: '/search?' + new URLSearchParams({ city: context.city ?? 'chennai' }),
          },
          { label: 'Contact support', href: '/support' },
        ],
      );
    result.provider = provider;
    return assistantReplySchema.parse(result);
  }
  app.post(
    '/api/v1/assistant/conversations/:conversationId/messages',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      const input = assistantMessageInputSchema.parse(req.body),
        id = checkedId(req.params.conversationId),
        actor = currentPrincipal(res),
        key = requireIdempotency(req),
        c = await owned(id, actor.userId),
        requestId = hash(actor.userId + ':' + key),
        digest = payloadHash({ id, ...input });
      const cached = await requests.findOne({ _id: requestId, userId: actor.userId });
      const cachedValue = () => {
        if (cached!.digest !== digest)
          throw new HttpError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This request key was used for a different message',
          );
        return dec<{ conversationId: string; version: number; turn: AssistantTurn }>(
          cached!.sealed,
        );
      };
      if (cached) {
        json(res, cachedValue(), 201);
        return;
      }
      if (c.version !== input.expectedVersion)
        throw new HttpError(
          409,
          'VERSION_CONFLICT',
          'This conversation changed; reload before sending',
        );
      const previous = dec<AssistantTurn[]>(c.turns);
      if (previous.length >= 50)
        throw new HttpError(409, 'CONVERSATION_LIMIT', 'Start a new conversation to continue');
      await quota(actor.userId, 'messages', config.ASSISTANT_DAILY_MESSAGES);
      const leaseToken = randomUUID(),
        leases = db.collection('assistant_user_leases');
      try {
        await leases.updateOne(
          { _id: actor.userId as never, leaseUntil: { $lte: new Date() } },
          { $set: { leaseUntil: new Date(Date.now() + 60000), leaseToken } },
          { upsert: true },
        );
      } catch {
        throw new HttpError(
          409,
          'ASSISTANT_BUSY',
          'Wait for your current assistant response or try again shortly',
        );
      }
      const controller = new AbortController(),
        sse = req.get('accept')?.includes('text/event-stream');
      res.once('close', () => {
        if (!res.writableEnded) controller.abort();
      });
      if (sse) {
        res.status(201).set({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
        res.write('event: progress\ndata: {"message":"Checking current information"}\n\n');
      }
      try {
        let result: AssistantReply;
        try {
          result = await answer(input.text, input.context, actor, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) return;
          result =
            error instanceof HttpError && [403, 404].includes(error.status)
              ? reply(
                  'DENIED',
                  'I can only read orders that belong to your signed-in account. Select one of your own orders or contact support.',
                  [{ label: 'Your orders', href: '/orders' }],
                )
              : error instanceof HttpError && error.code === 'CITY_REQUIRED'
                ? reply('HELP', 'Choose a supported city before searching menus.', [
                    { label: 'Choose a city', href: '/search' },
                  ])
                : reply(
                    'UNAVAILABLE',
                    'I could not verify current information right now. Please use search, your order page or support; no account action was performed.',
                    [
                      { label: 'Your orders', href: '/orders' },
                      { label: 'Contact support', href: '/support' },
                    ],
                  );
        }
        if (controller.signal.aborted) return;
        const turn: AssistantTurn = {
            id: randomUUID(),
            question: redactAssistantText(input.text),
            reply: result,
            at: new Date().toISOString(),
          },
          value = { conversationId: id, version: c.version + 1, turn },
          session = client.startSession();
        try {
          await session.withTransaction(async () => {
            const changed = await conversations.updateOne(
              { _id: id, userId: actor.userId, version: c.version },
              {
                $set: {
                  turns: enc([...previous, turn]),
                  title:
                    c.version === 1
                      ? {
                          FAQ: 'Help conversation',
                          MENU: 'Food discovery',
                          ORDER: 'Order help',
                          REFUND: 'Refund records',
                          HELP: 'General help',
                          SAFETY: 'Dietary help',
                          DENIED: 'Account boundaries',
                          UNAVAILABLE: 'Help request',
                        }[result.kind]
                      : c.title,
                  updatedAt: turn.at,
                },
                $inc: { version: 1 },
              },
              { session },
            );
            if (!changed.modifiedCount)
              throw new HttpError(409, 'VERSION_CONFLICT', 'Conversation changed; reload');
            await requests.insertOne(
              {
                _id: requestId,
                userId: actor.userId,
                conversationId: id,
                digest,
                sealed: enc(value),
                purgeAt: c.purgeAt,
              },
              { session },
            );
            await db.collection('assistant_tool_audit').insertOne(
              {
                userId: actor.userId,
                conversationId: id,
                intent: result.kind,
                outcome: result.kind === 'DENIED' ? 'DENIED' : 'COMPLETED',
                provider: result.provider,
                promptVersion: assistantVersion,
                at: turn.at,
                purgeAt: c.purgeAt,
              },
              { session },
            );
          });
        } finally {
          await session.endSession();
        }
        if (sse) {
          res.write('event: result\ndata: ' + JSON.stringify(value) + '\n\n');
          res.end();
        } else json(res, value, 201);
      } catch (error) {
        if (sse) {
          if (!res.destroyed) {
            res.write(
              'event: error\ndata: {"message":"Conversation changed or unavailable. Reload to recover."}\n\n',
            );
            res.end();
          }
        } else throw error;
      } finally {
        await leases.deleteOne({ _id: actor.userId as never, leaseToken });
      }
    },
  );
  async function proposal(
    conversationId: string,
    userId: string,
    kind: Action['kind'],
    payload: unknown,
    summary: string,
    key: string,
  ) {
    await owned(conversationId, userId);
    await quota(userId, 'proposals', 20);
    const value = await executeOnce(
      client,
      db,
      userId + ':assistant-proposal',
      key,
      { conversationId, kind, payload },
      async (session) => {
        if ((await actions.countDocuments({ conversationId, userId }, { session })) >= 30)
          throw new HttpError(409, 'ACTION_LIMIT', 'Start a new conversation for more proposals');
        const token = opaque(),
          id = randomUUID(),
          expiresAt = new Date(Date.now() + 300000).toISOString(),
          a: Action = {
            _id: id,
            conversationId,
            userId,
            kind,
            summary: enc(summary),
            expiresAt,
            purgeAt: new Date(Date.now() + 30 * 86400000),
            state: 'PROPOSED',
            payload: enc(payload),
            payloadHash: payloadHash(payload),
            tokenHash: hash(token),
            token: enc(token),
            resultHref: null,
            leaseUntil: new Date(0),
          };
        await actions.insertOne(a, { session });
        return { id };
      },
    );
    return publicAction((await actions.findOne({ _id: value.id, userId }))!);
  }
  app.post(
    '/api/v1/assistant/conversations/:conversationId/proposals',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      writes();
      const id = checkedId(req.params.conversationId),
        actor = currentPrincipal(res),
        input = assistantProposalInputSchema.parse(req.body);
      await owned(id, actor.userId);
      const preview = await internalCall<{
        input: unknown;
        expectedSubtotalMinor: number;
        summary: string;
      }>(ctx, 'restaurant', '/internal/v1/assistant-tools/cart-preview', {
        ...input,
        sessionId: actor.sessionId,
      });
      json(
        res,
        await proposal(id, actor.userId, 'cart', preview, preview.summary, requireIdempotency(req)),
        201,
      );
    },
  );
  app.post(
    '/api/v1/assistant/conversations/:conversationId/handoff',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      writes();
      const input = assistantHandoffSchema.parse(req.body),
        id = checkedId(req.params.conversationId),
        actor = currentPrincipal(res);
      await owned(id, actor.userId);
      const { consent: _consent, ...ticket } = input;
      ticket.text = redactAssistantText(ticket.text);
      ticket.subject = redactAssistantText(ticket.subject);
      await internalCall(ctx, 'admin', '/internal/v1/assistant-support/preview', {
        sessionId: actor.sessionId,
        ticket,
      });
      json(
        res,
        await proposal(
          id,
          actor.userId,
          'support',
          ticket,
          'Create a support ticket: ' +
            ticket.subject +
            '\nCategory: ' +
            ticket.category +
            '\nLinked order: ' +
            (ticket.orderId ?? 'None') +
            '\n' +
            ticket.text,
          requireIdempotency(req),
        ),
        201,
      );
    },
  );
  app.post(
    '/api/v1/assistant/actions/:actionId/confirm',
    remoteSession(ctx, { mutation: true }),
    async (req, res) => {
      writes();
      const input = assistantConfirmSchema.parse(req.body),
        id = checkedId(req.params.actionId),
        actor = currentPrincipal(res);
      requireIdempotency(req);
      const a = await actions.findOne({
        _id: id,
        userId: actor.userId,
        tokenHash: hash(input.confirmationToken),
      });
      if (!a) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found');
      await owned(a.conversationId, actor.userId);
      if (a.state === 'APPLIED') {
        json(res, publicAction(a));
        return;
      }
      if (a.state === 'REJECTED')
        throw new HttpError(409, 'ACTION_REJECTED', 'Review a new proposal before acting');
      if (a.state === 'PROPOSED' && Date.parse(a.expiresAt) <= Date.now())
        throw new HttpError(409, 'ACTION_EXPIRED', 'Review a new proposal');
      const claimed = await actions.findOneAndUpdate(
        {
          _id: id,
          userId: actor.userId,
          state: { $in: ['PROPOSED', 'EXECUTING'] },
          leaseUntil: { $lte: new Date() },
        },
        { $set: { state: 'EXECUTING', leaseUntil: new Date(Date.now() + 30000) } },
        { returnDocument: 'after' },
      );
      if (!claimed)
        throw new HttpError(
          409,
          'ACTION_BUSY',
          'The original action is being confirmed. Reload its status shortly',
        );
      try {
        const payload = dec<Record<string, unknown>>(a.payload);
        if (payloadHash(payload) !== a.payloadHash)
          throw new HttpError(409, 'ACTION_CHANGED', 'Action integrity check failed');
        const result = await internalCall<{ applied: boolean; href: string }>(
          ctx,
          a.kind === 'cart' ? 'restaurant' : 'admin',
          a.kind === 'cart'
            ? '/internal/v1/assistant-tools/cart-apply'
            : '/internal/v1/assistant-support/create',
          a.kind === 'cart'
            ? {
                sessionId: actor.sessionId,
                commandId: id,
                expiresAt: a.expiresAt,
                input: payload.input,
                expectedSubtotalMinor: payload.expectedSubtotalMinor,
              }
            : {
                sessionId: actor.sessionId,
                commandId: id,
                expiresAt: a.expiresAt,
                ticket: payload,
              },
        );
        if (!result.applied || !safeAssistantHref(result.href))
          throw new Error('Invalid action result');
        await actions.updateOne(
          { _id: id },
          { $set: { state: 'APPLIED', resultHref: result.href, leaseUntil: new Date(0) } },
        );
        json(res, publicAction((await actions.findOne({ _id: id }))!));
      } catch (error) {
        if (error instanceof HttpError && error.status < 500) {
          await actions.updateOne(
            { _id: id },
            { $set: { state: 'REJECTED', leaseUntil: new Date(0) } },
          );
          throw error;
        }
        await actions.updateOne({ _id: id }, { $set: { leaseUntil: new Date(0) } });
        throw new HttpError(
          503,
          'ACTION_CONFIRMATION_PENDING',
          'Confirmation is uncertain. Retry this same proposal; do not create another',
        );
      }
    },
  );
  // Admin-only knowledge and synthetic evaluation controls; never expose provider secrets.
  const admin = express.Router();
  admin.use(internalOnly(ctx, ['admin']));
  async function operator(sessionId: string, write = false) {
    const p = await internalCall<Principal>(ctx, 'auth', '/internal/v1/sessions/inspect', {
      sessionId,
    });
    requirePermission(p, write ? 'assistant:write' : 'assistant:read', write);
    return p;
  }
  admin.post('/content', async (req, res) => {
    await ready();
    const { actorSessionId } = z
      .object({ actorSessionId: z.string().uuid() })
      .strict()
      .parse(req.body);
    await operator(actorSessionId);
    json(
      res,
      (await content.find({}).sort({ topic: 1, version: -1 }).limit(200).toArray()).map(
        ({ _id: _id, seedKey: _seed, ...c }) => c,
      ),
    );
  });
  admin.post('/content-save', async (req, res) => {
    await ready();
    const input = z
        .object({
          actorSessionId: z.string().uuid(),
          commandId: z.string().min(16).max(128),
          contentId: z.string().uuid().nullable(),
          expectedVersion: z.number().int().nonnegative(),
          content: assistantContentInputSchema,
          status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
          reason: z.string().trim().min(5).max(500),
        })
        .strict()
        .parse(req.body),
      actor = await operator(input.actorSessionId, true);
    if (
      !safeAssistantHref(input.content.href) ||
      input.content.href.includes('?') ||
      !/^(\/help|\/support|\/orders|\/addresses|\/settings|\/settings\/sessions|\/seller\/onboarding|\/seller\/restaurants|\/rider\/onboarding|\/rider\/dashboard|\/rider\/offers|\/rider\/history|\/rider\/earnings)$/.test(
        input.content.href,
      )
    )
      throw new HttpError(422, 'INVALID_HELP_LINK', 'Choose an existing CraveCart help route');
    if (
      input.status === 'PUBLISHED' &&
      (Date.parse(input.content.expiresAt) <= Date.now() ||
        Date.parse(input.content.expiresAt) > Date.now() + 366 * 86400000)
    )
      throw new HttpError(
        422,
        'INVALID_HELP_EXPIRY',
        'Published help needs an expiry within one year',
      );
    const result = await executeOnce(
      client,
      db,
      actor.userId + ':assistant-content',
      input.commandId,
      input,
      async (session) => {
        const before = input.contentId
          ? await content.findOne({ _id: input.contentId }, { session })
          : null;
        if ((before?.version ?? 0) !== input.expectedVersion || (input.contentId && !before))
          throw new HttpError(409, 'VERSION_CONFLICT', 'Help content changed; reload');
        if (!before && (await content.countDocuments({}, { session })) >= 200)
          throw new HttpError(409, 'CONTENT_LIMIT', 'At most 200 help entries');
        const id = input.contentId ?? randomUUID(),
          value: Content = {
            _id: id,
            id,
            ...input.content,
            version: input.expectedVersion + 1,
            status: input.status,
            publishedAt: input.status === 'PUBLISHED' ? new Date().toISOString() : null,
            source: 'CraveCart approved help',
            ...(before?.seedKey ? { seedKey: before.seedKey } : {}),
          };
        await content.replaceOne({ _id: id }, value, { upsert: true, session });
        await db.collection('assistant_admin_audit').insertOne(
          {
            id: randomUUID(),
            actorId: actor.userId,
            action: 'assistant.content',
            reason: input.reason,
            contentId: id,
            before: before ? { version: before.version, status: before.status } : null,
            after: { version: value.version, status: value.status },
            at: new Date().toISOString(),
          },
          { session },
        );
        const { _id: _id, seedKey: _seed, ...c } = value;
        return c;
      },
    );
    json(res, result);
  });
  admin.post('/evaluations', async (req, res) => {
    await ready();
    const { actorSessionId } = z
      .object({ actorSessionId: z.string().uuid() })
      .strict()
      .parse(req.body);
    await operator(actorSessionId);
    json(res, {
      runs: await db
        .collection('assistant_evaluations')
        .find({}, { projection: { _id: 0 } })
        .sort({ at: -1 })
        .limit(10)
        .toArray(),
      promptVersion: assistantVersion,
      provider: config.ASSISTANT_PROVIDER,
      writesEnabled:
        config.ASSISTANT_WRITES_ENABLED === 'true' && config.ASSISTANT_WRITES_REVIEWED === 'true',
    });
  });
  admin.post('/evaluate', async (req, res) => {
    const input = z
        .object({
          actorSessionId: z.string().uuid(),
          reason: z.string().trim().min(5).max(500),
          commandId: z.string().min(16).max(128),
        })
        .strict()
        .parse(req.body),
      actor = await operator(input.actorSessionId, true);
    json(
      res,
      await executeOnce(
        client,
        db,
        actor.userId + ':assistant-evaluate',
        input.commandId,
        input,
        async (session) => {
          const value = {
            id: randomUUID(),
            ...evaluateAssistantRouting(),
            at: new Date().toISOString(),
          };
          await db.collection('assistant_evaluations').insertOne({ ...value }, { session });
          await db.collection('assistant_admin_audit').insertOne(
            {
              id: randomUUID(),
              action: 'assistant.evaluate',
              actorId: actor.userId,
              reason: input.reason,
              at: value.at,
            },
            { session },
          );
          return value;
        },
      ),
    );
  });
  app.use('/internal/v1/assistant-admin', admin);
  return { answer, ready };
}
