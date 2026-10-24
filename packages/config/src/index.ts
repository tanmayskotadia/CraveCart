import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  HOST: z.string().default('127.0.0.1'),
  MONGO_URI: z.string().default('mongodb://127.0.0.1:27017/?directConnection=true&replicaSet=rs0'),
  RABBITMQ_URL: z.string().default('amqp://cravecart:local-only@127.0.0.1:5672/cravecart'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  INTERNAL_TOKEN: z.string().min(32).default('development-only-internal-token-change-me'),
  DEV_ADAPTERS: z.enum(['true', 'false']).default('true'),
  SERVICE_NAME: z.string().default('unknown'),
  METRICS_TOKEN: z.string().min(32).default('development-only-metrics-token-change-me'),
  AUTH_SECRET: z.string().min(32).default('development-only-auth-secret-change-me'),
  AUTH_ENCRYPTION_KEY: z.string().min(32).default('development-only-encryption-key-change-me'),
  UPLOAD_ENCRYPTION_KEY: z.string().min(32).default('development-only-upload-key-change-me'),
  UPLOAD_DIRECTORY: z.string().default('.local/uploads'),
  UPLOAD_SCAN_MODE: z.enum(['development', 'clamav']).default('development'),
  CLAMD_HOST: z.string().default('127.0.0.1'),
  CLAMD_PORT: z.coerce.number().int().positive().default(3310),
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  COMMERCE_MODE: z.enum(['disabled', 'development', 'test', 'live']).default('disabled'),
  PAYMENT_LIVE_CONFIRMED: z.enum(['true', 'false']).default('false'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAY_ACCOUNT_ID: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_API_VERSION: z.string().optional(),
});
export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
  if (
    config.COMMERCE_MODE === 'development' &&
    (config.NODE_ENV === 'production' || config.DEV_ADAPTERS !== 'true')
  )
    throw new Error('Development commerce is forbidden outside explicit development adapters');
  if (
    config.COMMERCE_MODE === 'live' &&
    (config.PAYMENT_LIVE_CONFIRMED !== 'true' || config.DEV_ADAPTERS !== 'false')
  )
    throw new Error('Live commerce requires explicit confirmation and real adapters');
  if (['live', 'test'].includes(config.COMMERCE_MODE)) {
    const prefix = config.COMMERCE_MODE === 'live' ? 'live' : 'test';
    if (config.STRIPE_SECRET_KEY && !config.STRIPE_SECRET_KEY.startsWith(`sk_${prefix}_`))
      throw new Error('Stripe credentials do not match the commerce environment');
    if (config.RAZORPAY_KEY_ID && !config.RAZORPAY_KEY_ID.startsWith(`rzp_${prefix}_`))
      throw new Error('Razorpay credentials do not match the commerce environment');
  }
  if (config.NODE_ENV === 'production') {
    if (config.DEV_ADAPTERS !== 'false')
      throw new Error('Development adapters are forbidden in production');
    if (config.UPLOAD_SCAN_MODE !== 'clamav')
      throw new Error('Production uploads require malware scanning');
    for (const key of ['AUTH_SECRET', 'AUTH_ENCRYPTION_KEY', 'UPLOAD_ENCRYPTION_KEY'] as const) {
      if (!env[key] || /development|change-me/i.test(config[key]))
        throw new Error(`Production secret required: ${key}`);
    }
    if (
      new Set([
        config.AUTH_SECRET,
        config.AUTH_ENCRYPTION_KEY,
        config.UPLOAD_ENCRYPTION_KEY,
        config.INTERNAL_TOKEN,
        config.METRICS_TOKEN,
      ]).size !== 5
    )
      throw new Error('Secrets must be distinct');
    if (
      !env.INTERNAL_TOKEN ||
      !env.METRICS_TOKEN ||
      config.INTERNAL_TOKEN === config.METRICS_TOKEN ||
      /development|change-me/i.test(config.INTERNAL_TOKEN + config.METRICS_TOKEN)
    ) {
      throw new Error('Distinct production service and metrics credentials are required');
    }
    if (
      !config.APP_ORIGIN.startsWith('https://') ||
      !config.RABBITMQ_URL.startsWith('amqps://') ||
      !config.REDIS_URL.startsWith('rediss://') ||
      (!config.MONGO_URI.startsWith('mongodb+srv://') && !config.MONGO_URI.includes('tls=true'))
    ) {
      throw new Error('Production dependencies require verified TLS configuration');
    }
    for (const key of [
      'AUTH_URL',
      'RESTAURANT_URL',
      'RIDER_URL',
      'ADMIN_URL',
      'REALTIME_URL',
      'UTILS_URL',
    ]) {
      if (env.SERVICE_NAME === 'gateway' && !env[key])
        throw new Error(`Missing upstream configuration: ${key}`);
    }
  }
  return config;
}
