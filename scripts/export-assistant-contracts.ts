import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import {
  errorSchema,
  assistantConversationSchema,
  assistantMessageInputSchema,
  assistantTurnSchema,
  assistantActionSchema,
  assistantProposalInputSchema,
  assistantHandoffSchema,
  assistantConfirmSchema,
  assistantContentSchema,
  assistantContentInputSchema,
} from '../packages/contracts/src/index.js';
const paths: Record<string, Record<string, unknown>> = {};
function add(
  owner: string,
  method: string,
  path: string,
  result: z.ZodType,
  body?: z.ZodType,
  status = 200,
) {
  const schema = (s: z.ZodType) =>
    z.toJSONSchema(s, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' });
  const parameters: Array<Record<string, unknown>> = [...path.matchAll(/\{([^}]+)\}/g)].map(
    (m) => ({ in: 'path', name: m[1], required: true, schema: { type: 'string', format: 'uuid' } }),
  );
  if (method !== 'get')
    parameters.push(
      { in: 'header', name: 'Origin', required: true, schema: { type: 'string' } },
      {
        in: 'header',
        name: 'X-CSRF-Token',
        required: true,
        schema: { type: 'string', minLength: 32 },
      },
    );
  if (method !== 'get' && method !== 'delete')
    parameters.push({
      in: 'header',
      name: 'Idempotency-Key',
      required: true,
      schema: { type: 'string', minLength: 16, maxLength: 128 },
    });
  (paths[path] ??= {})[method] = {
    operationId: 'assistant_' + method + '_' + path.replace(/[^a-zA-Z0-9]/g, '_'),
    tags: [owner],
    summary: method.toUpperCase() + ' ' + path,
    'x-owner': owner,
    'x-contract-status': 'implementation-ready',
    'x-client-generation-ready': true,
    'x-authorization':
      'Authenticated owner; scoped live-data tools only. Administrative content changes require assistant grants and fresh MFA. Confirmations bind user, payload and expiry; domain commands remain authoritative.',
    security: [{ accessSession: [] }],
    parameters,
    ...(body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schema(body) } },
          },
        }
      : {}),
    responses: {
      [status]: {
        description:
          'Authoritative assistant resource. Never a model-generated payment or delivery claim.',
        content: {
          'application/json': {
            schema: schema(
              z
                .object({ data: result, meta: z.object({ requestId: z.string().uuid() }).strict() })
                .strict(),
            ),
          },
          ...(path.endsWith('/messages')
            ? {
                'text/event-stream': {
                  schema: {
                    type: 'string',
                    description:
                      'Progress frame followed by a committed result frame, or safe error. SSE replay can recover through the equivalent JSON response.',
                  },
                },
              }
            : {}),
        },
      },
      default: {
        description: 'Safe error envelope.',
        content: { 'application/json': { schema: schema(errorSchema) } },
      },
    },
  };
}
const id = z.string().uuid(),
  empty = z.object({}).strict(),
  version = z.number().int().positive();
add(
  'utils',
  'get',
  '/assistant/capabilities',
  z
    .object({
      enabled: z.boolean(),
      provider: z.enum(['builtin', 'openai']),
      writesEnabled: z.boolean(),
      dailyMessages: z.number().int(),
      promptVersion: z.string(),
    })
    .strict(),
);
add(
  'utils',
  'get',
  '/assistant/context/orders',
  z.array(
    z
      .object({
        id,
        number: z.string(),
        status: z.string(),
        paymentState: z.string(),
        version,
        refundRequestedMinor: z.number().int(),
        refundedMinor: z.number().int(),
        mode: z.string(),
        checkedAt: z.string().datetime(),
      })
      .strict(),
  ),
);
const summary = assistantConversationSchema.pick({
  id: true,
  version: true,
  title: true,
  createdAt: true,
  updatedAt: true,
});
add('utils', 'get', '/assistant/conversations', z.array(summary));
add('utils', 'post', '/assistant/conversations', assistantConversationSchema, empty, 201);
add('utils', 'get', '/assistant/conversations/{conversationId}', assistantConversationSchema);
add(
  'utils',
  'delete',
  '/assistant/conversations/{conversationId}',
  z.object({ deleted: z.boolean() }).strict(),
);
add(
  'utils',
  'post',
  '/assistant/conversations/{conversationId}/messages',
  z.object({ conversationId: id, version, turn: assistantTurnSchema }).strict(),
  assistantMessageInputSchema,
  201,
);
add(
  'utils',
  'post',
  '/assistant/conversations/{conversationId}/proposals',
  assistantActionSchema,
  assistantProposalInputSchema,
  201,
);
add(
  'utils',
  'post',
  '/assistant/conversations/{conversationId}/handoff',
  assistantActionSchema,
  assistantHandoffSchema,
  201,
);
add(
  'utils',
  'post',
  '/assistant/actions/{actionId}/confirm',
  assistantActionSchema,
  assistantConfirmSchema,
);
add('admin', 'get', '/admin/assistant/content', z.array(assistantContentSchema));
const contentBody = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    content: assistantContentInputSchema,
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
add('admin', 'post', '/admin/assistant/content', assistantContentSchema, contentBody);
add('admin', 'patch', '/admin/assistant/content/{contentId}', assistantContentSchema, contentBody);
const evaluation = z
  .object({
    id,
    at: z.string().datetime(),
    suiteVersion: z.string(),
    scope: z.string(),
    passed: z.number().int(),
    total: z.number().int(),
    accuracy: z.number().min(0).max(1),
    cases: z.array(
      z
        .object({
          name: z.string(),
          question: z.string(),
          expected: z.string(),
          actual: z.string(),
          passed: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
add(
  'admin',
  'get',
  '/admin/assistant/evaluations',
  z
    .object({
      runs: z.array(evaluation),
      promptVersion: z.string(),
      provider: z.string(),
      writesEnabled: z.boolean(),
    })
    .strict(),
);
add(
  'admin',
  'post',
  '/admin/assistant/evaluations',
  evaluation,
  z.object({ reason: z.string().trim().min(5).max(500) }).strict(),
);
writeFileSync('contracts/assistant.openapi.json', JSON.stringify(paths, null, 2) + '\n');
