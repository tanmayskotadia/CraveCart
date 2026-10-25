import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repositoryChecks } from './check-pilot-gates.mjs';
import { deploymentFingerprint } from './deployment-fingerprint.mjs';

if (!process.env.npm_execpath) throw new Error('Run using npm run verify:release');
const root = resolve('.local', `release-${randomUUID()}`);
await mkdir(root, { recursive: true });
// Fingerprint tracked and nonignored source without putting file contents in evidence logs.
async function repositoryFingerprint() {
  const files = execFileSync('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ])
    .toString()
    .split('\0')
    .filter(Boolean)
    .sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file + '\0');
    hash.update(await readFile(file));
  }
  return hash.digest('hex');
}
const report = {
  startedAt: new Date().toISOString(),
  sourceSha256: await repositoryFingerprint(),
  buildSha256: await deploymentFingerprint(),
  revision: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(),
  node: process.version,
  checks: [],
  passed: false,
  qualification:
    'Repository automation only. Hosted recovery, provider, capacity, physical-device and operator approval gates remain separate.',
};
const checks = repositoryChecks;
for (const name of checks) {
  console.log(`Checking ${name}`);
  const log = createWriteStream(resolve(root, `${name.replaceAll(':', '-')}.log`));
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, [process.env.npm_execpath, 'run', name], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  await new Promise((done) => log.end(done));
  report.checks.push({ name, startedAt, finishedAt: new Date().toISOString(), code });
  await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (code !== 0) {
    console.error(`Failed ${name}; evidence: ${root}`);
    process.exitCode = 1;
    break;
  }
}
report.finishedAt = new Date().toISOString();
report.sourceUnchanged = report.sourceSha256 === (await repositoryFingerprint());
report.deploymentInputsUnchanged = report.buildSha256 === (await deploymentFingerprint());
report.passed =
  report.sourceUnchanged &&
  report.deploymentInputsUnchanged &&
  report.checks.length === checks.length &&
  report.checks.every((check) => check.code === 0);
if (!report.passed) process.exitCode = 1;
await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Repository checks ${report.passed ? 'passed' : 'failed'}; evidence: ${root}`);
