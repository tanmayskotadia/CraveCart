import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assessPilot } from './check-pilot-gates.mjs';
import { hostedOrigin, hostedCheckNames } from './check-hosting.mjs';
import { deploymentFingerprint } from './deployment-fingerprint.mjs';

export const rolloutStages = ['internal-sandbox', 'invited', 'limited', 'expanded'];
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const fresh = (value, now, hours = 24) =>
  Number.isFinite(Date.parse(value)) &&
  Date.parse(value) <= now &&
  now - Date.parse(value) <= hours * 3600_000;
const number = (value) => Number.isSafeInteger(value) && value >= 0;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function assessObservation(value, build, previousStage, now = Date.now()) {
  if (
    value?.kind !== 'cravecart-stage-observation-v1' ||
    value.buildSha256 !== build ||
    value.stage !== previousStage ||
    !text(value.reviewer) ||
    !text(value.evidence) ||
    !fresh(value.finishedAt, now)
  )
    return false;
  const duration = Date.parse(value.finishedAt) - Date.parse(value.startedAt);
  if (!Number.isFinite(duration) || duration < 30 * 60_000 || duration > 24 * 3600_000)
    return false;
  for (const key of [
    'requestCount',
    'api5xxCount',
    'capturedOrders',
    'deliveredOrders',
    'criticalIncidents',
    'ledgerImbalances',
    'unmatchedCaptures',
    'duplicateAssignments',
    'noRiderOrders',
    'oldestOutboxSeconds',
  ])
    if (!number(value[key])) return false;
  return (
    value.requestCount >= 100 &&
    value.api5xxCount <= value.requestCount &&
    value.api5xxCount / value.requestCount < 0.01 &&
    value.capturedOrders >= 3 &&
    value.deliveredOrders >= 3 &&
    value.deliveredOrders <= value.capturedOrders &&
    [
      'criticalIncidents',
      'ledgerImbalances',
      'unmatchedCaptures',
      'duplicateAssignments',
      'noRiderOrders',
    ].every((key) => value[key] === 0) &&
    value.oldestOutboxSeconds <= 60
  );
}
export function assessLaunch(
  plan,
  { repository, pilot, hosted, observation, currentBuild },
  now = Date.now(),
) {
  const blocked = assessPilot(pilot, repository, now).blocked.map((reason) => `Pilot: ${reason}`);
  if (repository?.sourceUnchanged !== true || repository?.deploymentInputsUnchanged !== true)
    blocked.push('Verify a frozen source snapshot and deployment input set');
  if (plan?.kind !== 'cravecart-rollout-v1' || !rolloutStages.includes(plan.stage))
    blocked.push('Choose a supported rollout stage');
  if (
    !/^[a-f0-9]{64}$/.test(plan?.buildSha256 ?? '') ||
    plan.buildSha256 !== repository?.buildSha256 ||
    plan.buildSha256 !== currentBuild
  )
    blocked.push('Build identity must match the repository report and current deployment inputs');
  if (
    !['test', 'live'].includes(plan?.mode) ||
    (plan?.stage === 'internal-sandbox' && plan.mode !== 'test')
  )
    blocked.push('Choose a stage-appropriate payment mode');
  if (
    !text(plan?.review?.owner) ||
    !text(plan?.review?.evidence) ||
    !fresh(plan?.review?.reviewedAt, now)
  )
    blocked.push('Record a named release review within 24 hours');
  let originsValid = true;
  for (const key of ['app', 'api', 'realtime']) {
    try {
      if (hostedOrigin(plan?.origins?.[key]) !== hosted?.options?.[key]) originsValid = false;
    } catch {
      originsValid = false;
    }
  }
  if (!originsValid) blocked.push('Reviewed origins must match the hosted preflight');
  const gateways = plan?.requiredGateways;
  if (
    !Array.isArray(gateways) ||
    !gateways.length ||
    new Set(gateways).size !== gateways.length ||
    gateways.some((gateway) => !['razorpay', 'stripe'].includes(gateway)) ||
    JSON.stringify(gateways) !== JSON.stringify(hosted?.options?.gateways)
  )
    blocked.push('Reviewed gateways must match preflight');
  if (
    hosted?.kind !== 'hosted-launch-preflight' ||
    hosted.passed !== true ||
    hosted?.options?.expectedBuild !== plan?.buildSha256 ||
    hosted?.options?.mode !== plan?.mode ||
    !fresh(hosted?.finishedAt, now) ||
    !Array.isArray(hosted?.checks) ||
    hosted.checks.length !== hostedCheckNames.length ||
    hostedCheckNames.some(
      (name) =>
        hosted.checks.filter((check) => check.name === name && check.passed === true).length !== 1,
    )
  )
    blocked.push('Complete a passing hosted preflight for this build and mode within 24 hours');
  const cohort = plan?.cohort;
  for (const key of ['zoneIds', 'restaurantIds', 'riderIds'])
    if (
      !Array.isArray(cohort?.[key]) ||
      !cohort[key].length ||
      cohort[key].length > 1000 ||
      new Set(cohort[key]).size !== cohort[key].length ||
      cohort[key].some((id) => typeof id !== 'string' || !uuid.test(id))
    )
      blocked.push(`Name the actual reviewed ${key}`);
  if (
    !Array.isArray(cohort?.cities) ||
    !cohort.cities.length ||
    cohort.cities.some((city) => typeof city !== 'string' || !/^[a-z][a-z-]{1,59}$/.test(city)) ||
    new Set(cohort.cities).size !== cohort.cities.length ||
    !number(cohort?.maxActiveOrders) ||
    cohort.maxActiveOrders < 1 ||
    cohort.maxActiveOrders > 10000
  )
    blocked.push('Define a bounded city cohort and operator active-order limit');
  const coverage = plan?.coverage;
  if (
    !['primary', 'backup', 'support', 'finance', 'security'].every((key) =>
      text(coverage?.[key]),
    ) ||
    coverage.primary.trim() === coverage.backup.trim() ||
    !(Date.parse(coverage?.startsAt) <= now && Date.parse(coverage?.endsAt) > now)
  )
    blocked.push(
      'Name distinct primary/backup and staffed support/finance/security coverage for the launch window',
    );
  if (
    !['seller', 'rider', 'support', 'admin', 'alertDrill'].every((key) =>
      text(plan?.training?.[key]),
    )
  )
    blocked.push('Attach training and alert-acknowledgement rehearsal evidence');
  const stage = rolloutStages.indexOf(plan?.stage);
  if (
    stage > 0 &&
    (!text(plan?.previousStageEvidence) ||
      !assessObservation(observation, plan.buildSha256, rolloutStages[stage - 1], now))
  )
    blocked.push('Review a complete, healthy observation of the previous stage before expansion');
  return {
    passed: blocked.length === 0,
    stage: plan?.stage ?? null,
    mode: plan?.mode ?? null,
    blocked,
    limitation:
      'Operator gate only; this command does not deploy, activate zones, cap orders automatically or send notifications.',
  };
}
export async function readJson(path) {
  try {
    return JSON.parse(await readFile(path ?? '', 'utf8'));
  } catch {
    return undefined;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const plan = await readJson(process.env.LAUNCH_PLAN_PATH ?? 'docs/release/rollout-plan.json');
  const result = assessLaunch(plan, {
    repository: await readJson(process.env.RELEASE_REPORT),
    pilot: await readJson(process.env.PILOT_SIGNOFF_PATH ?? 'docs/release/pilot-signoff.json'),
    hosted: await readJson(process.env.HOSTED_CHECK_REPORT),
    observation: await readJson(process.env.STAGE_OBSERVATION_PATH),
    currentBuild: await deploymentFingerprint(),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
