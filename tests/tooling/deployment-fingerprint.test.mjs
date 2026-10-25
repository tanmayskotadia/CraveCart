import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, realpath, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { deploymentFingerprint } from '../../scripts/deployment-fingerprint.mjs';

test('deployment identity survives checkout line endings and excludes outputs/secrets but detects code changes', async () => {
  const parent = resolve('.local/fingerprint-tests');
  await mkdir(parent, { recursive: true });
  const roots = [await mkdtemp(join(parent, 'fixture-')), await mkdtemp(join(parent, 'fixture-'))];
  try {
    for (const [index, root] of roots.entries()) {
      await mkdir(join(root, 'apps/web/dist'), { recursive: true });
      for (const file of [
        'package.json',
        'package-lock.json',
        'tsconfig.base.json',
        'tsconfig.build.json',
        '.nvmrc',
        'render.yaml',
      ])
        await writeFile(join(root, file), 'fixture\n');
      await writeFile(
        join(root, 'apps/web/index.ts'),
        index ? 'line1\r\nline2\r\n' : 'line1\nline2\n',
      );
      await writeFile(join(root, 'apps/web/dist/ignored.json'), String(index));
      await writeFile(join(root, 'apps/web/.env'), `FIXTURE_SECRET=${index}`);
    }
    const expected = await deploymentFingerprint(roots[0]);
    assert.equal(await deploymentFingerprint(roots[1]), expected);
    await writeFile(join(roots[1], 'apps/web/index.ts'), 'changed deployment code');
    assert.notEqual(await deploymentFingerprint(roots[1]), expected);
  } finally {
    const base = await realpath(parent);
    for (const root of roots) {
      const target = await realpath(root);
      assert.ok(target.startsWith(base + sep), 'Fixture cleanup escaped its root');
      await rm(target, { recursive: true });
    }
  }
});
