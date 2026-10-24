import { randomUUID } from 'node:crypto';
import { context, propagation, trace, SpanStatusCode } from '@opentelemetry/api';
import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import pino from 'pino';

export { context, propagation, trace, SpanStatusCode, randomUUID };
export function createLogger(service: string) {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? 'info',
    redact: ['password', 'token', 'authorization', 'cookie', 'otp', 'body', 'headers', 'url'],
  });
}

export function startTelemetry(service: string) {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': `cravecart-${service}` }),
    spanProcessors: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
      ? [new BatchSpanProcessor(new OTLPTraceExporter())]
      : [],
  });
  provider.register();
  return () => provider.shutdown();
}

export function downstreamHeaders(requestId: string) {
  const headers: Record<string, string> = { 'x-request-id': requestId };
  propagation.inject(context.active(), headers);
  return headers;
}
