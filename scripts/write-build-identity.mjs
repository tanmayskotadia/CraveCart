import { writeFile } from 'node:fs/promises';
import { deploymentFingerprint } from './deployment-fingerprint.mjs';
const identity =
  JSON.stringify(
    { algorithm: 'cravecart-deployment-v1', buildSha256: await deploymentFingerprint() },
    null,
    2,
  ) + '\n';
await Promise.all(
  ['packages/platform/dist/release.json', 'apps/web/dist/release.json'].map((path) =>
    writeFile(path, identity),
  ),
);
console.log('Wrote matching frontend/backend deployment identities');
