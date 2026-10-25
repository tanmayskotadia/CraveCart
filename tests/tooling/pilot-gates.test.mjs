import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessPilot,
  requiredPilotGates,
  repositoryChecks,
} from '../../scripts/check-pilot-gates.mjs';

const now = Date.parse('2026-10-25T00:00:00Z');
function fixture() {
  const report = {
    passed: true,
    sourceSha256: 'a'.repeat(64),
    finishedAt: new Date(now).toISOString(),
    checks: repositoryChecks.map((name) => ({ name, code: 0 })),
  };
  const record = {
    sourceSha256: report.sourceSha256,
    releaseOwner: 'Fixture reviewer',
    reviewedAt: new Date(now).toISOString(),
    gates: Object.fromEntries(
      requiredPilotGates.map((key) => [
        key,
        { status: 'passed', owner: 'Fixture owner', evidence: 'Fixture evidence only' },
      ]),
    ),
  };
  return { report, record };
}
test('pilot cannot pass without a complete repository report and reviewed release record', () => {
  assert.equal(assessPilot({}, undefined, now).passed, false);
  const { record, report } = fixture();
  assert.equal(assessPilot(record, report, now).passed, true);
});
test('pilot fails on missing gates, mismatched source, failed automation or stale review', () => {
  for (const change of [
    ({ record }) => {
      delete record.gates.finance;
    },
    ({ record }) => {
      record.sourceSha256 = 'b'.repeat(64);
    },
    ({ report }) => {
      report.checks[0].code = 1;
    },
    ({ report }) => {
      report.checks[0].name = report.checks[1].name;
    },
    ({ report }) => {
      report.finishedAt = '2026-10-01T00:00:00Z';
    },
    ({ record }) => {
      record.reviewedAt = '2026-10-01T00:00:00Z';
    },
    ({ record }) => {
      record.gates.recovery.status = 'pending';
    },
    ({ record }) => {
      record.gates.security.evidence = '';
    },
  ]) {
    const input = fixture();
    change(input);
    assert.equal(assessPilot(input.record, input.report, now).passed, false);
  }
});
