import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryOptions, compareFingerprints } from '../../scripts/check-recovery.mjs';

test('restore verification rejects ambiguous targets and plaintext remote connections', () => {
  const env = {
    RESTORE_SOURCE_PREFIX: 'cravecart',
    RESTORE_TARGET_PREFIX: 'cc_restore_' + 'a'.repeat(32),
    RESTORE_SOURCE_URI: 'mongodb://127.0.0.1',
    RESTORE_TARGET_URI: 'mongodb+srv://fixture.example.test',
  };
  assert.equal(recoveryOptions(env).source, 'cravecart');
  for (const change of [
    { RESTORE_TARGET_PREFIX: 'cravecart' },
    { RESTORE_SOURCE_PREFIX: '../source' },
    { RESTORE_TARGET_URI: 'mongodb://remote.example.test' },
    { RESTORE_SOURCE_URI: '' },
  ])
    assert.throws(() => recoveryOptions({ ...env, ...change }));
});
test('restore comparison detects same-count corruption, lost indexes and lost TTL settings', () => {
  const original = [
    {
      name: 'records',
      count: 2,
      sha256: 'first-hash',
      indexes: [{ name: 'expiry', key: { expiresAt: 1 }, expireAfterSeconds: 0 }],
      options: {},
    },
  ];
  assert.ok(compareFingerprints(original, structuredClone(original)));
  for (const alter of [
    (copy) => {
      copy[0].sha256 = 'corrupt-hash';
    },
    (copy) => {
      copy[0].indexes = [];
    },
    (copy) => {
      copy[0].indexes[0].expireAfterSeconds = 60;
    },
    (copy) => {
      copy[0].count = 1;
    },
  ]) {
    const copy = structuredClone(original);
    alter(copy);
    assert.equal(compareFingerprints(original, copy), false);
  }
});
