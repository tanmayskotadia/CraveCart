import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { platformSchema, errorSchema } from '@cravecart/contracts';

const operation = {
  get: {
    operationId: 'admin_get_platform', tags: ['admin'], summary: 'Public India-wide discovery and launch capabilities',
    'x-owner': 'admin', 'x-contract-status': 'implementation-ready', 'x-client-generation-ready': true,
    'x-authorization': 'Public read-only launch configuration. No identity, private settings or dependency URLs.',
    security: [], parameters: [],
    description: 'No query parameters or request body. Returns capabilities only, never authentication grants. Unknown query parameters return 400. Request ID is a canonical UUID; valid incoming X-Request-ID is preserved. No-store response. No idempotency key because this is a read.',
    responses: {
      '200': {description: 'Current public launch capability snapshot', content: {'application/json': {schema: z.toJSONSchema(platformSchema, {target: 'draft-2020-12'})}}},
      '400': {description: 'Invalid query', content: {'application/json': {schema: z.toJSONSchema(errorSchema)}}},
      '429': {description: 'Rate limited', content: {'application/json': {schema: z.toJSONSchema(errorSchema)}}},
      '503': {description: 'Gateway cannot retrieve a valid correlated snapshot', content: {'application/json': {schema: z.toJSONSchema(errorSchema)}}},
      default: {description: 'Structured error', content: {'application/json': {schema: z.toJSONSchema(errorSchema)}}},
    },
  },
};
writeFileSync('contracts/platform.openapi.json', JSON.stringify(operation, null, 2) + '\n');
