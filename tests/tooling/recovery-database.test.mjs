import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { MongoClient, BSON } from 'mongodb';
import { databaseFingerprint, compareFingerprints } from '../../scripts/check-recovery.mjs';

test(
  'real Mongo comparison detects changed values and indexes despite equal record counts',
  { timeout: 120_000 },
  async () => {
    process.env.MONGOMS_DOWNLOAD_DIR = resolve('.local/mongo-binaries');
    const replica = await MongoMemoryReplSet.create({
      binary: { version: '8.0.17' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const client = new MongoClient(replica.getUri());
    const prefix = 'cc_restore_fixture_' + randomUUID().replaceAll('-', '');
    const original = client.db(prefix + '_source'),
      restored = client.db(prefix + '_target');
    try {
      await client.connect();
      const docs = [
        {
          _id: 'a',
          minor: 105,
          at: new Date('2026-10-25T00:00:00Z'),
          ciphertext: new BSON.Binary(Buffer.from('fixture-only')),
        },
        { _id: 'b', minor: 200, at: new Date('2026-10-25T00:00:00Z') },
      ];
      for (const db of [original, restored]) {
        await db
          .collection('ledger')
          .insertMany(docs.map((doc) => BSON.deserialize(BSON.serialize(doc))));
        await db.collection('ledger').createIndex({ at: 1 }, { expireAfterSeconds: 315_360_000 });
      }
      const source = await databaseFingerprint(original);
      assert.ok(compareFingerprints(source, await databaseFingerprint(restored)));
      await restored.collection('ledger').updateOne({ _id: 'b' }, { $set: { minor: 201 } });
      assert.equal(compareFingerprints(source, await databaseFingerprint(restored)), false);
      await restored.collection('ledger').updateOne({ _id: 'b' }, { $set: { minor: 200 } });
      await restored.collection('ledger').dropIndex('at_1');
      assert.equal(compareFingerprints(source, await databaseFingerprint(restored)), false);
    } finally {
      await Promise.all([original.dropDatabase(), restored.dropDatabase()]);
      await client.close();
      await replica.stop();
    }
  },
);
