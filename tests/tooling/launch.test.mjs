import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessLaunch, assessObservation } from '../../scripts/check-launch.mjs';
import { repositoryChecks, requiredPilotGates } from '../../scripts/check-pilot-gates.mjs';
import { hostedCheckNames } from '../../scripts/check-hosting.mjs';

const now = Date.parse('2026-10-25T12:00:00Z'),
  date = new Date(now).toISOString(),
  build = 'b'.repeat(64);
function fixture() {
  const repository = {
    passed: true,
    sourceUnchanged: true,
    deploymentInputsUnchanged: true,
    sourceSha256: 'a'.repeat(64),
    buildSha256: build,
    finishedAt: date,
    checks: repositoryChecks.map((name) => ({ name, code: 0 })),
  };
  const pilot = {
    sourceSha256: repository.sourceSha256,
    releaseOwner: 'Fixture owner',
    reviewedAt: date,
    gates: Object.fromEntries(
      requiredPilotGates.map((name) => [
        name,
        { status: 'passed', owner: 'Fixture owner', evidence: 'Synthetic fixture' },
      ]),
    ),
  };
  const origins = {
    app: 'https://app.example.test',
    api: 'https://api.example.test',
    realtime: 'https://realtime.example.test',
  };
  const hosted = {
    kind: 'hosted-launch-preflight',
    passed: true,
    finishedAt: date,
    options: { ...origins, expectedBuild: build, mode: 'test', gateways: ['razorpay'] },
    checks: hostedCheckNames.map((name) => ({ name, passed: true })),
  };
  const plan = {
    kind: 'cravecart-rollout-v1',
    buildSha256: build,
    stage: 'internal-sandbox',
    mode: 'test',
    origins,
    requiredGateways: ['razorpay'],
    cohort: {
      cities: ['chennai'],
      zoneIds: ['11111111-1111-4111-8111-111111111111'],
      restaurantIds: ['22222222-2222-4222-8222-222222222222'],
      riderIds: ['33333333-3333-4333-8333-333333333333'],
      maxActiveOrders: 5,
    },
    review: { owner: 'Fixture reviewer', reviewedAt: date, evidence: 'Synthetic release review' },
    coverage: {
      startsAt: date,
      endsAt: new Date(now + 3600_000).toISOString(),
      primary: 'Fixture primary',
      backup: 'Fixture backup',
      support: 'Fixture support',
      finance: 'Fixture finance',
      security: 'Fixture security',
    },
    training: {
      seller: 'Fixture',
      rider: 'Fixture',
      support: 'Fixture',
      admin: 'Fixture',
      alertDrill: 'Fixture',
    },
    previousStageEvidence: '',
  };
  return { plan, evidence: { repository, pilot, hosted, currentBuild: build } };
}
test('launch gate accepts complete synthetic evidence and keeps default/missing records closed', () => {
  const { plan, evidence } = fixture();
  assert.equal(assessLaunch(plan, evidence, now).passed, true);
  assert.equal(assessLaunch({}, {}, now).passed, false);
});
test('launch gate rejects mixed builds, live sandbox, missing coverage and forged/incomplete check lists', () => {
  for (const change of [
    ({ evidence }) => {
      evidence.currentBuild = 'c'.repeat(64);
    },
    ({ evidence }) => {
      evidence.repository.sourceUnchanged = false;
    },
    ({ evidence }) => {
      evidence.hosted.checks[0].name = evidence.hosted.checks[1].name;
    },
    ({ plan }) => {
      plan.mode = 'live';
    },
    ({ plan }) => {
      plan.coverage.backup = plan.coverage.primary;
    },
    ({ plan }) => {
      plan.cohort.zoneIds = [];
    },
    ({ plan }) => {
      plan.training.alertDrill = '';
    },
    ({ plan }) => {
      plan.stage = 'invited';
    },
    ({ evidence }) => {
      evidence.hosted.finishedAt = '2026-10-20T00:00:00Z';
    },
  ]) {
    const input = fixture();
    change(input);
    assert.equal(assessLaunch(input.plan, input.evidence, now).passed, false);
  }
});
test('stage progression requires measured windows and refuses empty, unhealthy or unrelated observations', () => {
  const observation = {
    kind: 'cravecart-stage-observation-v1',
    buildSha256: build,
    stage: 'internal-sandbox',
    startedAt: new Date(now - 1800_000).toISOString(),
    finishedAt: date,
    reviewer: 'Fixture reviewer',
    evidence: 'Synthetic observations',
    requestCount: 100,
    api5xxCount: 0,
    capturedOrders: 3,
    deliveredOrders: 3,
    criticalIncidents: 0,
    ledgerImbalances: 0,
    unmatchedCaptures: 0,
    duplicateAssignments: 0,
    noRiderOrders: 0,
    oldestOutboxSeconds: 20,
  };
  assert.equal(assessObservation(observation, build, 'internal-sandbox', now), true);
  for (const change of [
    { requestCount: null },
    { capturedOrders: 0 },
    { oldestOutboxSeconds: 61 },
    { ledgerImbalances: 1 },
    { api5xxCount: 1 },
    { stage: 'expanded' },
    { startedAt: date },
  ])
    assert.equal(
      assessObservation({ ...observation, ...change }, build, 'internal-sandbox', now),
      false,
    );
  const { plan, evidence } = fixture();
  plan.stage = 'invited';
  plan.previousStageEvidence = 'Synthetic reviewed checkpoint';
  evidence.observation = observation;
  assert.equal(assessLaunch(plan, evidence, now).passed, true);
});
