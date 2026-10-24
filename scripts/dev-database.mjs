import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
const data = resolve('.local/mongo');
await mkdir(data, { recursive: true });
process.env.MONGOMS_DOWNLOAD_DIR = resolve('.local/mongo-binaries');
const database = await MongoMemoryReplSet.create({
  binary: { version: '8.0.17', checkMD5: true },
  instanceOpts: [{ port: 27017, dbPath: data }],
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
});
console.log(
  'Development MongoDB replica set is ready on 127.0.0.1:27017. Data is persisted under .local/mongo.',
);
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  await database.stop({ doCleanup: false });
}
process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});
