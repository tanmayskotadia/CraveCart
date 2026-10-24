import { it, expect } from 'vitest';
import request from 'supertest';
import {
  NodeTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { createApp } from '@cravecart/platform';
import { loadConfig } from '@cravecart/config';

it('propagates a real parent span and request ID from gateway into the owner service', async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  provider.register();
  const config = loadConfig({ NODE_ENV: 'test' });
  const resources = { check: async () => ({ test: true }), close: async () => {} };
  const admin = createApp({ name: 'admin', config, resources });
  let forwardedTrace = '';
  const gateway = createApp({
    name: 'gateway',
    config,
    resources,
    fetcher: async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      forwardedTrace = headers.traceparent ?? '';
      const response = await request(admin).get('/api/v1/platform').set(headers);
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  try {
    const response = await request(gateway).get('/api/v1/platform');
    expect(response.status).toBe(200);
    expect(forwardedTrace).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    await provider.forceFlush();
    const spans = exporter.getFinishedSpans();
    const outer = spans.find((span) => span.name === 'gateway GET');
    const inner = spans.find((span) => span.name === 'admin GET');
    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
    expect(inner?.spanContext().traceId).toBe(outer?.spanContext().traceId);
    expect(inner?.parentSpanContext?.spanId).toBe(outer?.spanContext().spanId);
  } finally {
    await provider.shutdown();
  }
});
