import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareHostedEnvironment } from '../../scripts/prepare-hosted-env.mjs';

test('hosted preparation generates distinct secrets once, preserves provider values and never reports values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cravecart-env-'));
  try {
    const template = join(root, 'template');
    const target = join(root, '.env.hosted');
    await writeFile(
      template,
      'NODE_ENV=production\nMONGO_URI=private-provider-uri\nAUTH_SECRET=\nMETRICS_TOKEN=""\n',
    );
    const first = await prepareHostedEnvironment(template, target);
    assert.equal(first.generated.length, 5);
    assert.equal(first.created, true);
    assert.ok(!first.missingRequiredSettings.includes('MONGO_URI'));
    const contents = await readFile(target, 'utf8');
    const secrets = [
      ...contents.matchAll(
        /^(?:INTERNAL_TOKEN|METRICS_TOKEN|AUTH_SECRET|AUTH_ENCRYPTION_KEY|UPLOAD_ENCRYPTION_KEY)=([a-f0-9]{96})$/gm,
      ),
    ].map((match) => match[1]);
    assert.equal(new Set(secrets).size, 5);
    for (const secret of [...secrets, 'private-provider-uri'])
      assert.ok(!JSON.stringify(first).includes(secret));
    const second = await prepareHostedEnvironment(template, target);
    assert.deepEqual(second.generated, []);
    assert.equal(await readFile(target, 'utf8'), contents);
    assert.equal(second.created, false);
    await writeFile(target, 'AUTH_SECRET=first\nAUTH_SECRET=second\n');
    await assert.rejects(
      () => prepareHostedEnvironment(template, target),
      /Duplicate environment setting: AUTH_SECRET/,
    );
    assert.equal(await readFile(target, 'utf8'), 'AUTH_SECRET=first\nAUTH_SECRET=second\n');
  } finally {
    // The target is the exact directory returned by mkdtemp, never a user-supplied path.
    await rm(root, { recursive: true, force: true });
  }
});

for (const newline of ['\n', '\r\n']) {
  test(`hosted preparation preserves adjacent blank provider settings with ${newline.length === 2 ? 'Windows' : 'Unix'} line endings`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'cravecart-env-'));
    try {
      const template = join(root, 'template');
      const target = join(root, '.env.hosted');
      await writeFile(
        template,
        [
          'APP_ORIGIN=',
          'INTERNAL_TOKEN=',
          'METRICS_TOKEN=',
          'AUTH_SECRET=',
          'AUTH_ENCRYPTION_KEY=',
          'UPLOAD_ENCRYPTION_KEY=',
          'MONGO_URI=',
          '',
        ].join(newline),
      );
      const first = await prepareHostedEnvironment(template, target);
      assert.equal(first.generated.length, 5);
      const contents = await readFile(target, 'utf8');
      assert.ok(contents.startsWith(`APP_ORIGIN=${newline}INTERNAL_TOKEN=`));
      assert.ok(contents.endsWith(`MONGO_URI=${newline}`));
      const second = await prepareHostedEnvironment(template, target);
      assert.deepEqual(second.generated, []);
      assert.ok(second.missingRequiredSettings.includes('APP_ORIGIN'));
      assert.ok(second.missingRequiredSettings.includes('MONGO_URI'));
      assert.equal(await readFile(target, 'utf8'), contents);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
