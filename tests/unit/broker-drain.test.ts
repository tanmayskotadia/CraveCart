import { EventEmitter } from 'node:events';
import { expect, it, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

const state = vi.hoisted(() => ({
  deliver: undefined as undefined | ((message: unknown) => void),
}));
vi.mock('amqplib', async () => {
  const { EventEmitter } = await import('node:events');
  const connect = vi.fn(async () => {
    const channel = Object.assign(new EventEmitter(), {
      assertExchange: vi.fn(),
      assertQueue: vi.fn(),
      bindQueue: vi.fn(),
      prefetch: vi.fn(),
      consume: vi.fn(async (_queue, deliver) => {
        state.deliver = deliver;
        return { consumerTag: 'consumer' };
      }),
      cancel: vi.fn(async () => {}),
      ack: vi.fn(),
      nack: vi.fn(),
    });
    const connection = Object.assign(new EventEmitter(), {
      createConfirmChannel: async () => channel,
      close: vi.fn(async () => {}),
    });
    return connection;
  });
  return { default: { connect } };
});
import amqp from 'amqplib';
import { RabbitBroker } from '@cravecart/persistence';
beforeEach(() => vi.clearAllMocks());

it('cancels intake and awaits an active consumer before closing dependencies', async () => {
  let finish!: () => void;
  const handler = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const broker = new RabbitBroker('amqp://fixture', 'drain-test');
  broker.subscribe(['notification.created.v1'], handler);
  await broker.ready();
  const connection = await vi.mocked(amqp.connect).mock.results[0]!.value;
  const channel = await connection.createConfirmChannel();
  expect(channel).toBeInstanceOf(EventEmitter);
  state.deliver!({
    content: Buffer.from(
      JSON.stringify({
        eventId: randomUUID(),
        eventType: 'notification.created.v1',
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        producer: 'utils',
        aggregate: { type: 'notification', id: 'notice_001', version: 1 },
        correlationId: randomUUID(),
        causationId: randomUUID(),
        data: { notificationId: 'notice_001', userId: 'user_001', category: 'test' },
      }),
    ),
  });
  expect(handler).toHaveBeenCalledOnce();
  const closing = broker.close();
  await vi.waitFor(() => expect(channel.cancel).toHaveBeenCalledWith('consumer'));
  expect(connection.close).not.toHaveBeenCalled();
  await expect(broker.ready()).rejects.toThrow('draining');
  finish();
  await closing;
  expect(channel.ack).toHaveBeenCalledOnce();
  expect(connection.close).toHaveBeenCalledOnce();
});

it('keeps a reconnected channel when an older connection closes late', async () => {
  const broker = new RabbitBroker('amqp://fixture', 'reconnect-test');
  await broker.ready();
  const previous = await vi.mocked(amqp.connect).mock.results[0]!.value;
  const previousChannel = await previous.createConfirmChannel();
  previousChannel.emit('close');
  await broker.ready();
  expect(amqp.connect).toHaveBeenCalledTimes(2);
  previous.emit('close');
  await broker.ready();
  expect(amqp.connect).toHaveBeenCalledTimes(2);
  await broker.close();
});
