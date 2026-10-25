import type { Express } from 'express';
import { z } from 'zod';
import { assistantContentInputSchema } from '@cravecart/contracts';
import {
  remoteSession,
  currentPrincipal,
  internalCall,
  requireIdempotency,
  checkedId,
  json,
  type DomainContext,
} from '@cravecart/platform';
export function installAssistantAdmin(app: Express, ctx: DomainContext) {
  for (const resource of ['content', 'evaluations'] as const)
    app.get(
      '/api/v1/admin/assistant/' + resource,
      remoteSession(ctx, { permission: 'assistant:read' }),
      async (_req, res) =>
        json(
          res,
          await internalCall(ctx, 'utils', '/internal/v1/assistant-admin/' + resource, {
            actorSessionId: currentPrincipal(res).sessionId,
          }),
        ),
    );
  for (const method of ['post', 'patch'] as const)
    app[method](
      method === 'post'
        ? '/api/v1/admin/assistant/content'
        : '/api/v1/admin/assistant/content/:contentId',
      remoteSession(ctx, { permission: 'assistant:write', stepUp: true, mutation: true }),
      async (req, res) => {
        const input = z
          .object({
            expectedVersion: z.number().int().nonnegative(),
            content: assistantContentInputSchema,
            status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
            reason: z.string().trim().min(5).max(500),
          })
          .strict()
          .parse(req.body);
        json(
          res,
          await internalCall(ctx, 'utils', '/internal/v1/assistant-admin/content-save', {
            ...input,
            contentId: method === 'patch' ? checkedId(req.params.contentId) : null,
            commandId: requireIdempotency(req),
            actorSessionId: currentPrincipal(res).sessionId,
          }),
        );
      },
    );
  app.post(
    '/api/v1/admin/assistant/evaluations',
    remoteSession(ctx, { permission: 'assistant:write', stepUp: true, mutation: true }),
    async (req, res) => {
      const { reason } = z
        .object({ reason: z.string().trim().min(5).max(500) })
        .strict()
        .parse(req.body);
      json(
        res,
        await internalCall(ctx, 'utils', '/internal/v1/assistant-admin/evaluate', {
          reason,
          commandId: requireIdempotency(req),
          actorSessionId: currentPrincipal(res).sessionId,
        }),
      );
    },
  );
}
