import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import amqp, { type ChannelModel } from 'amqplib';
import { createClient } from 'redis';
import {
  MongoClient,
  ensurePersistence,
  executeOnce,
  enqueueEvent,
  dispatchOutbox,
  consumeOnce,
  IdempotencyConflict,
  RabbitBroker,
} from '@cravecart/persistence';
import type { DomainEvent } from '@cravecart/contracts';

const mongoUrl = process.env.MONGO_URI;
const rabbitUrl = process.env.RABBITMQ_URL;
const redisUrl = process.env.REDIS_URL;
if (!mongoUrl || !rabbitUrl || !redisUrl)
  throw new Error(
    'Real dependency tests require MONGO_URI, RABBITMQ_URL and REDIS_URL. Start the Compose stack first.',
  );
const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 5000 });
const db = client.db(`cravecart_test_${randomUUID().replaceAll('-', '')}`);
const broker = new RabbitBroker(rabbitUrl, 'integration');
let connection: ChannelModel;
const redis = createClient({ url: redisUrl });
redis.on('error', () => {});
const queue = `integration.${randomUUID()}`;
beforeAll(async () => {
  await client.connect();
  await ensurePersistence(db);
  await db.createCollection('effects');
  connection = await amqp.connect(rabbitUrl);
  await broker.ready();
  await redis.connect();
});
afterAll(async () => {
  await db.dropDatabase();
  await client.close();
  await broker.close();
  await connection?.close();
  if (redis.isOpen) await redis.close();
});

it('commits atomically and survives uncertain publish plus consumer commit-before-ack crash', async () => {
  expect(await redis.ping()).toBe('PONG');
  const setup = await connection.createChannel();
  await setup.assertQueue(queue, { durable: true });
  await setup.bindQueue(queue, 'cravecart.domain.v1', 'notification.created.v1');
  const event: DomainEvent = {
    eventId: randomUUID(),
    eventType: 'notification.created.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    producer: 'utils',
    aggregate: { type: 'notification', id: 'notice_001', version: 1 },
    correlationId: randomUUID(),
    causationId: randomUUID(),
    data: { notificationId: 'notice_001', userId: 'user_001', category: 'test' },
  };
  const command = async () =>
    executeOnce(client, db, 'test-user:notify', 'stable-key', { value: 100 }, async (session) => {
      await db.collection('effects').insertOne({ kind: 'command' }, { session });
      await enqueueEvent(db, session, event);
      return { ok: true };
    });
  expect(await command()).toEqual({ ok: true });
  expect(await command()).toEqual({ ok: true });
  expect(await db.collection('effects').countDocuments({ kind: 'command' })).toBe(1);
  await expect(
    executeOnce(client, db, 'test-user:notify', 'stable-key', { value: 101 }, async () => ({})),
  ).rejects.toBeInstanceOf(IdempotencyConflict);
  await expect(
    executeOnce(client, db, 'test-user:notify', 'rollback-key', {}, async (session) => {
      await db.collection('effects').insertOne({ kind: 'rolled-back' }, { session });
      throw new Error('crash before commit');
    }),
  ).rejects.toThrow('crash');
  expect(await db.collection('effects').countDocuments({ kind: 'rolled-back' })).toBe(0);
  // The broker accepted the first publish, but the process lost its confirmation/result.
  expect(
    await dispatchOutbox(db, {
      publish: async (value) => {
        await broker.publish(value);
        throw new Error('lost confirmation');
      },
    }),
  ).toBe('retry');
  expect(await dispatchOutbox(db, broker, new Date(Date.now() + 65_000))).toBe('sent');
  const apply = async (input: unknown) =>
    consumeOnce(client, db, 'test-consumer', input, async (_event, session) => {
      await db.collection('effects').insertOne({ kind: 'consumer' }, { session });
    });
  const first = await setup.get(queue, { noAck: false });
  expect(first).not.toBe(false);
  if (!first) throw new Error('Missing first broker message');
  expect(await apply(JSON.parse(first.content.toString()))).toBe(true);
  await setup.close(); // Simulate process/channel loss after DB commit, before ack.
  const recovered = await connection.createChannel();
  let received = 0;
  await vi.waitFor(
    async () => {
      const message = await recovered.get(queue, { noAck: false });
      if (message) {
        expect(await apply(JSON.parse(message.content.toString()))).toBe(false);
        recovered.ack(message);
        received++;
      }
      expect(received).toBe(2);
    },
    { timeout: 5000, interval: 50 },
  );
  expect(await db.collection('effects').countDocuments({ kind: 'consumer' })).toBe(1);
  expect(await db.collection('outbox').countDocuments({ state: 'sent' })).toBe(1);
  await recovered.deleteQueue(queue);
  await recovered.close();
});

it('drains a real consumer before closing and isolates unsupported event versions in the dead queue', async () => {
  const owner = `drain_${randomUUID().replaceAll('-', '')}`;
  const consumer = new RabbitBroker(rabbitUrl!, owner);
  let release!: () => void;
  const applied = vi.fn(
    () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  consumer.subscribe(['notification.created.v1'], applied);
  const channel = await connection.createConfirmChannel();
  try {
    await consumer.ready();
    const event: DomainEvent = {
      eventId: randomUUID(),
      eventType: 'notification.created.v1',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      producer: 'utils',
      aggregate: { type: 'notification', id: 'notice_001', version: 1 },
      correlationId: randomUUID(),
      causationId: randomUUID(),
      data: { notificationId: 'notice_001', userId: 'user_001', category: 'test' },
    };
    // Bypass typed publisher deliberately: test the actual consumer boundary against poison input.
    channel.publish(
      'cravecart.domain.v1',
      event.eventType,
      Buffer.from(JSON.stringify({ ...event, schemaVersion: 999 })),
      { persistent: true },
    );
    await channel.waitForConfirms();
    await vi.waitFor(async () => {
      const poison = await channel.get(`${owner}.dead.v1`, { noAck: true });
      expect(poison).not.toBe(false);
    });
    expect(applied).not.toHaveBeenCalled();
    await broker.publish(event);
    await vi.waitFor(() => expect(applied).toHaveBeenCalledOnce());
    let closed = false;
    const closing = consumer.close().then(() => {
      closed = true;
    });
    await new Promise((done) => setTimeout(done, 50));
    expect(closed).toBe(false);
    release();
    await closing;
    expect((await channel.checkQueue(`${owner}.domain.v1`)).messageCount).toBe(0);
  } finally {
    release?.();
    await consumer.close();
    for (const queue of [`${owner}.domain.v1`, `${owner}.dead.v1`])
      await channel.deleteQueue(queue);
    await channel.close();
  }
});
