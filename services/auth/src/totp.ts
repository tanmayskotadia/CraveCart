import { createHmac, randomBytes } from 'node:crypto';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function encodeBase32(bytes: Buffer) {
  let bits = 0,
    value = 0,
    result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
export function decodeBase32(text: string) {
  let bits = 0,
    value = 0;
  const output: number[] = [];
  for (const char of text.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid authenticator secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}
export const newTotpSecret = () => encodeBase32(randomBytes(20));
export function totp(secret: string, now = Date.now(), digits = 6) {
  const counter = Math.floor(now / 30_000);
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(bytes).digest();
  const offset = digest[digest.length - 1]! & 15;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 10 ** digits).padStart(digits, '0');
}
export function matchingCounter(
  secret: string,
  code: string,
  lastCounter: number,
  now = Date.now(),
) {
  if (!/^\d{6}$/.test(code)) return null;
  for (const delta of [-1, 0, 1]) {
    const counter = Math.floor(now / 30_000) + delta;
    if (counter > lastCounter && counter >= 0 && totp(secret, counter * 30_000) === code)
      return counter;
  }
  return null;
}
