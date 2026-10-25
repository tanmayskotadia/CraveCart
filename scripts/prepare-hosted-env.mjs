import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const internalKeys = [
  'INTERNAL_TOKEN',
  'METRICS_TOKEN',
  'AUTH_SECRET',
  'AUTH_ENCRYPTION_KEY',
  'UPLOAD_ENCRYPTION_KEY',
];
const requiredProviderSettings = [
  'MONGO_URI',
  'RABBITMQ_URL',
  'REDIS_URL',
  'APP_ORIGIN',
  'CLAMD_HOST',
  'SMTP_URL',
  'SMTP_FROM',
];

// Never log values or replace configured secrets: rotating encryption keys loses access to data.
export async function prepareHostedEnvironment(templatePath, targetPath) {
  let contents;
  let created = false;
  try {
    contents = await readFile(targetPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    contents = await readFile(templatePath, 'utf8');
    created = true;
  }
  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const lines = contents.split(/\r?\n/);
  const values = new Map();
  const indices = new Map();
  for (const [index, line] of lines.entries()) {
    const match = /^[\t ]*([A-Z][A-Z0-9_]*)[\t ]*=[\t ]*(.*?)[\t ]*$/.exec(line);
    if (!match) continue;
    if (values.has(match[1])) throw new Error(`Duplicate environment setting: ${match[1]}`);
    values.set(match[1], match[2]);
    indices.set(match[1], index);
  }
  const generated = [];
  for (const key of internalKeys) {
    const value = values.get(key);
    if (value && value !== '""' && value !== "''") continue;
    const secret = randomBytes(48).toString('hex');
    const index = indices.get(key);
    if (index !== undefined) lines[index] = `${key}=${secret}`;
    else lines.push(`${key}=${secret}`);
    values.set(key, secret);
    generated.push(key);
  }
  if (created || generated.length) {
    // Exclusive creation prevents two first-time runs from silently rotating each other's keys.
    await writeFile(targetPath, lines.join(newline), {
      encoding: 'utf8',
      mode: 0o600,
      flag: created ? 'wx' : 'w',
    });
    await chmod(targetPath, 0o600);
  }
  const configured = (key) => {
    const value = values.get(key);
    return Boolean(value && value !== '""' && value !== "''");
  };
  return {
    created,
    generated,
    missingRequiredSettings: requiredProviderSettings.filter((key) => !configured(key)),
    missingRazorpaySettings: [
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
    ].filter((key) => !configured(key)),
    note: 'Presence checks only. Provider credentials, TLS connectivity, merchant activation and webhook delivery still require verification. No secrets are included in this report.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    const report = await prepareHostedEnvironment(
      resolve(root, '.env.hosted.example'),
      resolve(root, '.env.hosted'),
    );
    console.log(JSON.stringify(report, null, 2));
  } catch {
    console.error(
      'Hosted environment preparation failed. No environment values were printed. Check file access and duplicate setting names.',
    );
    process.exitCode = 1;
  }
}
