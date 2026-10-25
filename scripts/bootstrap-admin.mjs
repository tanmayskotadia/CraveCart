import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
try {
  process.loadEnvFile('.env');
} catch {
  /* Optional for local development. */
}
const prompt = createInterface({ input: stdin, output: stdout });
const contact = (
  await prompt.question('Verified operator contact to provision (email or Indian mobile): ')
)
  .trim()
  .toLowerCase();
const name = (await prompt.question('Administrator display name: ')).trim();
prompt.close();
if (!/^(?:[6-9]\d{9}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(contact) || name.length < 2)
  throw new Error('Invalid administrator details');
const client = new MongoClient(
  process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/?directConnection=true&replicaSet=rs0',
);
try {
  await client.connect();
  const db = client.db(`${process.env.MONGO_DB_PREFIX ?? 'cravecart'}_auth`);
  await db.collection('users').createIndex({ contact: 1 }, { unique: true });
  const user = await db.collection('users').findOne({ contact });
  await db.collection('users').updateOne(
    { contact },
    {
      $set: {
        name,
        status: 'ACTIVE',
        permissions: [
          'assistant:read',
          'assistant:write',
          'support:read',
          'support:write',
          'reports:read',
          'promotions:read',
          'promotions:write',
          'staff:read',
          'staff:write',
          'zones:read',
          'zones:write',
          'verifications:read',
          'verifications:write',
          'users:read',
          'users:write',
          'audit:read',
          'dispatch:write',
          'dispatch:read',
          'finance:read',
          'finance:write',
        ],
      },
      $addToSet: { roles: { $each: ['customer', 'admin'] } },
      $setOnInsert: { _id: randomUUID(), createdAt: new Date() },
    },
    { upsert: true },
  );
  if (user)
    await db
      .collection('sessions')
      .updateMany({ userId: user._id }, { $set: { revokedAt: new Date() } });
  console.log(
    'Administrator provisioned. Primary-contact verification and authenticator enrollment are still required at login. No message was sent.',
  );
} finally {
  await client.close();
}
