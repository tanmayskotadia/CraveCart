import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const requiredPilotGates = [
  'scope',
  'security',
  'providers',
  'capacity',
  'resilience',
  'recovery',
  'finance',
  'privacy',
  'accessibility',
  'tracking',
  'operations',
  'deployment',
];
export const repositoryChecks = [
  'build',
  'typecheck',
  'lint',
  'format:check',
  'test',
  'test:tooling',
  'test:identity',
  'test:money',
  'test:money:providers',
  'test:fulfillment',
  'contracts:check',
  'test:e2e',
  'test:delivery:browser',
];

export function assessPilot(record, report, now = Date.now()) {
  const blocked = [];
  if (
    !report?.passed ||
    !Array.isArray(report.checks) ||
    report.checks.length !== repositoryChecks.length ||
    repositoryChecks.some(
      (name) =>
        report.checks.filter((check) => check.name === name && check.code === 0).length !== 1,
    )
  )
    blocked.push('Repository verification must pass');
  if (
    !/^[a-f0-9]{64}$/.test(record?.sourceSha256 ?? '') ||
    record.sourceSha256 !== report?.sourceSha256
  )
    blocked.push('Sign-off must identify the verified source fingerprint');
  const date = Date.parse(record?.reviewedAt ?? '');
  const finishedAt = Date.parse(report?.finishedAt ?? '');
  if (
    !Number.isFinite(date) ||
    !Number.isFinite(finishedAt) ||
    finishedAt > date ||
    date > now ||
    now - finishedAt > 7 * 86400_000 ||
    !record?.releaseOwner?.trim()
  )
    blocked.push('A named release owner must review a completed report within seven days');
  for (const key of requiredPilotGates) {
    const gate = record?.gates?.[key];
    if (gate?.status !== 'passed' || !gate?.owner?.trim() || !gate?.evidence?.trim())
      blocked.push(`${key}: missing passed evidence and accountable owner`);
  }
  return { passed: blocked.length === 0, blocked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let report;
  try {
    report = JSON.parse(await readFile(process.env.RELEASE_REPORT ?? '', 'utf8'));
  } catch {
    /* Missing report is a closed gate. */
  }
  const record = JSON.parse(
    await readFile(process.env.PILOT_SIGNOFF_PATH ?? 'docs/release/pilot-signoff.json', 'utf8'),
  );
  const assessment = assessPilot(record, report);
  console.log(JSON.stringify(assessment, null, 2));
  if (!assessment.passed) process.exitCode = 1;
}
