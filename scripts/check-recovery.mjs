import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BSON, MongoClient } from 'mongodb';

// Read-only verification. This does not create a backup or perform a restore.
export async function databaseFingerprint(db) {
  const collections = await db.listCollections({}, { nameOnly: false }).toArray();
  const result = [];
  for (const collection of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    if (collection.type !== 'collection' || collection.name.startsWith('system.'))
      throw new Error('Unsupported collection type; use provider-native verification');
    const hash = createHash('sha256');
    let count = 0;
    for await (const document of db.collection(collection.name).find().sort({ _id: 1 })) {
      const bytes = BSON.serialize(document);
      const size = Buffer.alloc(4);
      size.writeUInt32BE(bytes.length);
      hash.update(size);
      hash.update(bytes);
      count++;
    }
    const indexes = (await db.collection(collection.name).listIndexes().toArray())
      .map(({ v: _version, ns: _namespace, ...index }) => index)
      .sort((a, b) => a.name.localeCompare(b.name));
    result.push({
      name: collection.name,
      count,
      sha256: hash.digest('hex'),
      indexes,
      options: collection.options ?? {},
    });
  }
  return result;
}

export function compareFingerprints(source, restored) {
  return JSON.stringify(source) === JSON.stringify(restored);
}

export function recoveryOptions(env) {
  const source = env.RESTORE_SOURCE_PREFIX,
    target = env.RESTORE_TARGET_PREFIX;
  if (
    !source ||
    !/^[a-z][a-z0-9_]{2,45}$/.test(source) ||
    !/^cc_restore_[a-f0-9]{32}$/.test(target ?? '') ||
    source === target
  )
    throw new Error('Specify source prefix and a distinct cc_restore_<32 lowercase hex> target');
  for (const key of ['RESTORE_SOURCE_URI', 'RESTORE_TARGET_URI']) {
    if (!env[key] || !/^mongodb(?:\+srv)?:\/\//.test(env[key]))
      throw new Error(`Configure ${key} securely`);
    let options;
    try {
      options = new MongoClient(env[key]).options;
    } catch {
      throw new Error('Invalid MongoDB connection settings');
    }
    const loopback =
      !options.srvHost &&
      options.hosts?.length &&
      options.hosts.every((host) => ['localhost', '127.0.0.1', '::1'].includes(host.host));
    if (!loopback && !options.tls) throw new Error('Remote restore verification requires TLS');
  }
  return { source, target };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { source, target } = recoveryOptions(process.env);
  const clients = [process.env.RESTORE_SOURCE_URI, process.env.RESTORE_TARGET_URI].map(
    (uri) => new MongoClient(uri, { serverSelectionTimeoutMS: 5000, readPreference: 'primary' }),
  );
  const report = {
    kind: 'read-only-restore-comparison',
    startedAt: new Date().toISOString(),
    source,
    target,
    owners: [],
    passed: false,
  };
  try {
    await Promise.all(clients.map((client) => client.connect()));
    for (const owner of ['auth', 'restaurant', 'rider', 'admin', 'realtime', 'utils']) {
      const [original, restored] = await Promise.all([
        databaseFingerprint(clients[0].db(`${source}_${owner}`)),
        databaseFingerprint(clients[1].db(`${target}_${owner}`)),
      ]);
      // Empty/missing owner databases must not pass a vacuous comparison.
      report.owners.push({
        owner,
        passed: original.length > 0 && compareFingerprints(original, restored),
        sourceCollections: original.length,
        restoredCollections: restored.length,
      });
    }
    report.passed = report.owners.every((owner) => owner.passed);
    report.finishedAt = new Date().toISOString();
    await mkdir('.local/recovery', { recursive: true });
    const path = `.local/recovery/${target}.json`;
    await writeFile(path, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ...report, evidence: path }, null, 2));
    if (!report.passed) process.exitCode = 1;
  } catch {
    // Driver exceptions can contain connection URIs and record values.
    console.error(
      'Restore verification failed. Check connectivity, reader grants and supported collections. No data or credentials logged.',
    );
    process.exitCode = 1;
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
  }
}
