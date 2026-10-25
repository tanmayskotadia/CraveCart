import { describe, it, expect } from 'vitest';
import {
  assistantEvaluationCases,
  assistantIntent,
  evaluateAssistantRouting,
  redactAssistantText,
  safeAssistantHref,
  faqAnswer,
  bundledHelp,
} from '../../services/utils/src/assistant-engine.js';
import { loadConfig } from '@cravecart/config';
import type { Principal, AssistantContent } from '@cravecart/contracts';
import manifest from '../../contracts/routes.json' with { type: 'json' };
import { matchPath } from 'react-router-dom';
describe('grounded assistant routing', () => {
  it.each(bundledHelp)('answers approved $topic help with the exact versioned source', (entry) => {
    const c: AssistantContent = {
      id: '12345678-1234-1234-1234-123456789012',
      ...entry,
      version: 7,
      status: 'PUBLISHED',
      publishedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      source: 'CraveCart approved help',
    };
    const answer = faqAnswer([c], entry.topic, {
      roles: ['customer', 'seller', 'rider'],
    } as Principal);
    expect(answer.kind).toBe('FAQ');
    expect(answer.text).toBe(entry.answer);
    expect(answer.sources[0]).toMatchObject({ href: entry.href, version: 7 });
  });
  it.each(assistantEvaluationCases)('$name', (c) =>
    expect(assistantIntent(c.question).kind).toBe(c.expected),
  );
  it('reports executed routing checks without claiming live model evaluation', () => {
    const report = evaluateAssistantRouting();
    expect(report.accuracy).toBe(1);
    expect(report.scope).toContain('only');
  });
  it('removes payment numbers, contacts, verification codes and order identifiers from stored questions', () => {
    const text = redactAssistantText(
      'Email person@example.test phone 9876543210 code 123456 card 4111 1111 1111 1111 order 12345678-1234-1234-1234-123456789012',
    );
    for (const sensitive of ['person@example.test', '9876543210', '123456', '4111 1111'])
      expect(text).not.toContain(sensitive);
  });
  it('rejects invented, external, encoded and injected navigation targets', () => {
    for (const path of [
      'https://evil.test',
      '//evil.test',
      '/orders/not-real',
      '/admin/users',
      '/restaurants/x%2fy',
      '/orders/../admin',
      '/search?redirect=https://evil.test',
      '/help#imaginary',
    ])
      expect(safeAssistantHref(path)).toBe(false);
    for (const path of [
      '/orders',
      '/support',
      '/search?city=chennai&q=biryani',
      '/restaurants/test-chennai-kitchen',
    ]) {
      expect(safeAssistantHref(path)).toBe(true);
      expect(
        manifest.routes.some(
          (r) => matchPath({ path: r.path, end: true }, path.split('?')[0]!) && r.path !== '*',
        ),
      ).toBe(true);
    }
  });
  it('does not retrieve expired or wrong-audience help', () => {
    const actor = { roles: ['customer'] } as Principal;
    const c = {
      id: '12345678-1234-1234-1234-123456789012',
      topic: 'payments',
      question: 'How to pay?',
      answer: 'A versioned approved payment answer.',
      href: '/orders',
      audience: 'seller',
      version: 1,
      status: 'PUBLISHED',
      publishedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      source: 'CraveCart approved help',
    } as AssistantContent;
    expect(faqAnswer([c], 'payments', actor).kind).toBe('UNAVAILABLE');
    expect(
      faqAnswer(
        [{ ...c, audience: 'all', expiresAt: new Date(0).toISOString() }],
        'payments',
        actor,
      ).kind,
    ).toBe('UNAVAILABLE');
    const result = faqAnswer([{ ...c, audience: 'all' }], 'payments', actor);
    expect(result.kind).toBe('FAQ');
    expect(result.sources[0]?.version).toBe(1);
  });
  it('keeps writes disabled until recorded review and requires explicit provider settings', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).ASSISTANT_WRITES_ENABLED).toBe('false');
    expect(() => loadConfig({ NODE_ENV: 'test', ASSISTANT_WRITES_ENABLED: 'true' })).toThrow(
      'review',
    );
    expect(() => loadConfig({ NODE_ENV: 'test', ASSISTANT_PROVIDER: 'openai' })).toThrow(
      'explicit model',
    );
  });
});
