import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MongoClient, MongoServerError, type Db, type ClientSession } from 'mongodb';
import amqp, { type ChannelModel, type ConfirmChannel, type Message } from 'amqplib';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { domainEventSchema, type DomainEvent } from '@cravecart/contracts';

interface Command {
  _id: string;
  hash: string;
  result: unknown;
  createdAt: Date;
}
interface Inbox {
  _id: string;
  handledAt: Date;
}
interface Outbox {
  _id: string;
  event: DomainEvent;
  state: 'pending' | 'sent' | 'failed';
  attempts: number;
  nextAttemptAt: Date;
  leaseUntil: Date;
  leaseOwner?: string;
  sentAt?: Date;
}

const ajv = new Ajv2020({ allErrors: false, strict: false });
addFormats.default(ajv);
const validatePayload = ajv.compile(
  JSON.parse(
    readFileSync(new URL('../../../contracts/events.schema.json', import.meta.url), 'utf8'),
  ),
);
export function validateEvent(input: unknown): DomainEvent {
  if (!validatePayload(input)) throw new Error('Invalid or unsupported domain event');
  return domainEventSchema.parse(input);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('Idempotency payload must be JSON');
  return result;
}
export function payloadHash(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export class IdempotencyConflict extends Error {
  constructor() {
    super('Idempotency key was reused with a different payload');
  }
}

export async function ensurePersistence(db: Db) {
  // Create collections before the first transaction, including on a fresh replica set.
  for (const name of ['commands', 'outbox', 'inbox']) {
    try {
      await db.createCollection(name);
    } catch (error) {
      if (!(error instanceof MongoServerError && error.code === 48)) throw error;
    }
  }
  await db.collection<Outbox>('outbox').createIndex({ state: 1, nextAttemptAt: 1, leaseUntil: 1 });
}

/** The handler may perform local database writes only; never provider/network side effects. */
export async function executeOnce<T>(
  client: MongoClient,
  db: Db,
  scope: string,
  key: string,
  payload: unknown,
  handler: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const id = payloadHash([scope, key]);
  const hash = payloadHash(payload);
  const commands = db.collection<Command>('commands');
  const checkStored = (stored: Command): T => {
    if (stored.hash !== hash) throw new IdempotencyConflict();
    return stored.result as T;
  };
  const session = client.startSession();
  try {
    return (await session.withTransaction(
      async () => {
        const existing = await commands.findOne({ _id: id }, { session });
        if (existing) return checkStored(existing);
        const result = await handler(session);
        await commands.insertOne({ _id: id, hash, result, createdAt: new Date() }, { session });
        return result;
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    )) as T;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      const existing = await commands.findOne({ _id: id });
      if (existing) return checkStored(existing);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function enqueueEvent(db: Db, session: ClientSession, input: DomainEvent) {
  const event = validateEvent(input);
  await db.collection<Outbox>('outbox').insertOne(
    {
      _id: event.eventId,
      event,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(0),
      leaseUntil: new Date(0),
    },
    { session },
  );
}

export async function consumeOnce(
  client: MongoClient,
  db: Db,
  consumer: string,
  input: unknown,
  handler: (event: DomainEvent, session: ClientSession) => Promise<void>,
) {
  const event = validateEvent(input);
  const id = payloadHash([consumer, event.eventId]);
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const inbox = db.collection<Inbox>('inbox');
      if (await inbox.findOne({ _id: id }, { session })) return false;
      await inbox.insertOne({ _id: id, handledAt: new Date() }, { session });
      await handler(event, session);
      return true;
    });
  } catch (error) {
    if (
      error instanceof MongoServerError &&
      error.code === 11000 &&
      (await db.collection<Inbox>('inbox').findOne({ _id: id }))
    )
      return false;
    throw error;
  } finally {
    await session.endSession();
  }
}

export interface Publisher {
  publish(event: DomainEvent): Promise<void>;
}
export async function dispatchOutbox(db: Db, publisher: Publisher, now = new Date()) {
  const records = db.collection<Outbox>('outbox');
  const leaseOwner = randomUUID();
  const record = await records.findOneAndUpdate(
    { state: 'pending', nextAttemptAt: { $lte: now }, leaseUntil: { $lte: now } },
    { $set: { leaseOwner, leaseUntil: new Date(now.getTime() + 30_000) }, $inc: { attempts: 1 } },
    { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
  );
  if (!record) return 'idle';
  try {
    await publisher.publish(record.event);
    await records.updateOne(
      { _id: record._id, leaseOwner },
      { $set: { state: 'sent', sentAt: new Date(), leaseUntil: new Date(0) } },
    );
    return 'sent';
  } catch {
    const failed = record.attempts >= 5;
    await records.updateOne(
      { _id: record._id, leaseOwner },
      {
        $set: {
          state: failed ? 'failed' : 'pending',
          leaseUntil: new Date(0),
          nextAttemptAt: new Date(
            now.getTime() +
              Math.min(60_000, 1000 * 2 ** record.attempts) +
              Math.floor(Math.random() * 250),
          ),
        },
      },
    );
    return failed ? 'failed' : 'retry';
  }
}

export class RabbitBroker implements Publisher {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private connecting?: Promise<void>;
  private closing = false;
  private consumerTag?: string;
  private inFlight = new Set<Promise<void>>();
  private subscriptions: Array<{
    events: string[];
    handler: (event: DomainEvent) => Promise<void>;
  }> = [];
  subscribe(events: string[], handler: (event: DomainEvent) => Promise<void>) {
    if (this.channel) throw new Error('Register consumers before connecting');
    this.subscriptions.push({ events, handler });
  }
  constructor(
    private readonly url: string,
    private readonly owner: string,
  ) {}
  async ready() {
    if (this.closing) throw new Error('Broker is draining');
    if (this.channel) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }
  private async open() {
    const connection = await amqp.connect(this.url, { timeout: 1500 });
    connection.on('error', () => {
      /* Report through readiness; never log the credential URL. */
    });
    connection.on('close', () => {
      // A late close from an old connection must not invalidate a newly reconnected channel.
      if (this.connection === connection) {
        this.channel = undefined;
        this.connection = undefined;
        this.consumerTag = undefined;
      }
    });
    this.connection = connection;
    try {
      const channel = await connection.createConfirmChannel();
      channel.on('error', () => {});
      channel.on('close', () => {
        if (this.channel === channel) this.channel = undefined;
        void connection.close().catch(() => {});
      });
      await channel.assertExchange('cravecart.domain.v1', 'topic', { durable: true });
      await channel.assertExchange('cravecart.dead.v1', 'topic', { durable: true });
      await channel.assertQueue(`${this.owner}.dead.v1`, { durable: true });
      await channel.bindQueue(`${this.owner}.dead.v1`, 'cravecart.dead.v1', `${this.owner}.#`);
      // Durable owner queue; invalid messages are dead-lettered for operator review.
      await channel.assertQueue(`${this.owner}.domain.v1`, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'cravecart.dead.v1',
          'x-dead-letter-routing-key': `${this.owner}.rejected`,
        },
      });
      await channel.prefetch(10);
      for (const eventType of new Set(this.subscriptions.flatMap((value) => value.events)))
        await channel.bindQueue(`${this.owner}.domain.v1`, 'cravecart.domain.v1', eventType);
      if (this.subscriptions.length) {
        const consumer = await channel.consume(
          `${this.owner}.domain.v1`,
          (message) => {
            if (!message) return;
            const work = (async () => {
              try {
                const event = validateEvent(JSON.parse(message.content.toString('utf8')));
                const handlers = this.subscriptions.filter((value) =>
                  value.events.includes(event.eventType),
                );
                if (!handlers.length) throw new Error('Unsupported owner event');
                for (const value of handlers) await value.handler(event);
                channel.ack(message);
              } catch {
                try {
                  channel.nack(message, false, false);
                } catch {
                  // Connection loss leaves the message unacknowledged for redelivery.
                }
              }
            })();
            this.inFlight.add(work);
            void work.finally(() => this.inFlight.delete(work));
          },
          { noAck: false },
        );
        this.consumerTag = consumer.consumerTag;
      }
      this.channel = channel;
    } catch (error) {
      await connection.close().catch(() => {});
      throw error;
    }
  }
  async publish(event: DomainEvent) {
    validateEvent(event);
    await this.ready();
    const channel = this.channel!;
    await new Promise<void>((resolve, reject) => {
      let returned = false;
      const onReturn = (message: Message) => {
        if (message.properties.messageId === event.eventId) returned = true;
      };
      const timer = setTimeout(() => {
        channel.off('return', onReturn);
        void channel.close().catch(() => {});
        reject(new Error('Publish confirmation timed out'));
      }, 5000);
      channel.on('return', onReturn);
      channel.publish(
        'cravecart.domain.v1',
        event.eventType,
        Buffer.from(JSON.stringify(event)),
        {
          persistent: true,
          mandatory: true,
          messageId: event.eventId,
          contentType: 'application/json',
        },
        (error: unknown) => {
          clearTimeout(timer);
          channel.off('return', onReturn);
          if (error || returned) reject(new Error('Publish was not durably routed'));
          else resolve();
        },
      );
    });
  }
  async close() {
    this.closing = true;
    await this.connecting?.catch(() => {});
    if (this.channel && this.consumerTag)
      await this.channel.cancel(this.consumerTag).catch(() => {});
    // Keep MongoDB available until active consumer transactions and acknowledgements finish.
    await Promise.allSettled([...this.inFlight]);
    await this.connection?.close().catch(() => {});
    this.channel = undefined;
  }
}

export { MongoClient };
