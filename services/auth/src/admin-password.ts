import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}
export async function hashAdminPassword(password: string) {
  if (password.length < 16 || password.length > 128)
    throw new Error('Administrator passwords must contain 16–128 characters');
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}
export async function verifyAdminPassword(password: string, encoded: string) {
  const valid = /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded);
  const parts = encoded.split(':');
  const salt = valid ? Buffer.from(parts[1]!, 'hex') : Buffer.alloc(16);
  const expected = valid ? Buffer.from(parts[2]!, 'hex') : Buffer.alloc(64);
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected) && valid;
}
