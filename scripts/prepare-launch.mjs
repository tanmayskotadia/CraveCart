import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { deploymentFingerprint } from './deployment-fingerprint.mjs';
import { readJson } from './check-launch.mjs';

const root = resolve('.local', `launch-${randomUUID()}`);
await mkdir(root, { recursive: true });
const buildSha256 = await deploymentFingerprint();
const repository = await readJson(process.env.RELEASE_REPORT);
const manifest = {
  kind: 'cravecart-launch-handoff-v1',
  preparedAt: new Date().toISOString(),
  buildSha256,
  repositoryChecksMatchBuild:
    repository?.passed === true && repository?.buildSha256 === buildSha256,
  deploymentPerformed: false,
  launchApproved: false,
  documents: [
    'docs/MANUAL-SETUP-AND-LAUNCH.md',
    'docs/engineering/COMPLETION-AUDIT.md',
    'docs/engineering/HOSTING.md',
    'docs/release/LAUNCH-HANDBOOK.md',
    'docs/release/PARTNER-TRAINING.md',
    'docs/engineering/INCIDENT-RUNBOOKS.md',
    'docs/release/PILOT-READINESS.md',
    'docs/release/rollout-plan.json',
    'docs/release/stage-observation.json',
    'docs/release/pilot-signoff.json',
  ],
  note: 'Preparation does not qualify providers, real devices, backups, load or operating policies. Complete the linked gates before public/live rollout.',
};
for (const from of manifest.documents) {
  const target = resolve(root, from);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(from, target);
}
await writeFile(
  resolve(root, 'README.md'),
  '# CraveCart launch handoff\n\nStart with [the launch handbook](docs/release/LAUNCH-HANDBOOK.md) and [training](docs/release/PARTNER-TRAINING.md). Use this operating packet with the reviewed source repository for all linked contracts and deployment files. It is not a standalone application archive.\n\nRead manifest.json for the build identity and verification linkage. configuration-names.json contains setting names only. No hosting accounts or paid resources were created, and no live rollout is approved by preparing this packet.\n',
);
const envExample = await readFile('.env.hosted.example', 'utf8');
const names = [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);
await writeFile(
  resolve(root, 'configuration-names.json'),
  JSON.stringify(
    {
      backendSettingNames: [...new Set(names)],
      frontendSettingNames: ['VITE_REALTIME_ORIGIN', 'VITE_MAP_TILE_URL', 'VITE_MAP_ATTRIBUTION'],
      note: 'Names only. Configure secret values in hosting dashboards.',
    },
    null,
    2,
  ) + '\n',
);
await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `Launch handoff prepared: ${root}\nBuild identity: ${buildSha256}\nNo accounts provisioned or live actions performed.`,
);
