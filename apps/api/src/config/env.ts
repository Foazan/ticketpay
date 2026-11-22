import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/** Finds the repository root .env by walking up from the current directory. */
function loadDotenv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      config({ path: candidate });
      return;
    }
    dir = dirname(dir);
  }
}

const hex64 = /^[0-9a-f]{64}$/i;

const schema = z
  .object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters. Run "pnpm secrets" and paste the output into .env'),
  // Public base URL of this API, used in links sent to merchants (demo webhook receiver).
  API_PUBLIC_URL: z.string().url().optional(),
  WEBHOOK_SECRET_ENC_KEY: z.string().regex(hex64, 'WEBHOOK_SECRET_ENC_KEY must be 64 hex characters. Run "pnpm secrets" and paste the output into .env'),
  PAYMENT_PROVIDER: z.enum(['mock', 'midtrans']).default('mock'),
  MIDTRANS_SERVER_KEY: z.string().default(''),
  MIDTRANS_CLIENT_KEY: z.string().default(''),
  // Since 28 Oct 2026 Midtrans signs notifications with the Signature Secret Key, not the Server Key.
  // Comma-separated: while rotating, list the new key and the old one so retried notifications still verify.
  MIDTRANS_SIGNATURE_SECRET_KEY: z.string().default(''),
  MIDTRANS_IS_PRODUCTION: z.enum(['true', 'false']).default('false'),
  // Comma-separated subset of VA,QRIS,EWALLET that is enabled in your Midtrans sandbox account.
  MIDTRANS_ENABLED_METHODS: z.string().default('VA,QRIS,EWALLET'),
  // Confirm every notification with Midtrans' Get Status API before applying it (recommended by Midtrans).
  MIDTRANS_VERIFY_STATUS: z.enum(['true', 'false']).default('true'),
  // Overridable only so tests can point the adapter at a local fake. Leave unset.
  MIDTRANS_SNAP_URL: z.string().url().default('https://app.sandbox.midtrans.com/snap/v1/transactions'),
  MIDTRANS_API_URL: z.string().url().default('https://api.sandbox.midtrans.com'),
  // How long after a hold expires the sweeper waits for a late provider notification before expiring the order.
  EXPIRY_GRACE_MS: z.coerce.number().int().min(0).default(120_000),
  // Run the BullMQ workers inside the API process. Set false to run them elsewhere.
  RUN_WORKERS: z.enum(['true', 'false']).default('true'),
  // First retry delay for merchant webhooks; doubles each attempt.
  WEBHOOK_RETRY_BASE_MS: z.coerce.number().int().min(10).default(30_000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(6),
  CHAIN_MODE: z.enum(['disabled', 'local', 'sepolia']).default('disabled'),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === 'midtrans' && !env.MIDTRANS_SERVER_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MIDTRANS_SERVER_KEY'],
        message: 'PAYMENT_PROVIDER=midtrans needs MIDTRANS_SERVER_KEY (Midtrans dashboard > Sandbox > Settings > Access Keys). Or set PAYMENT_PROVIDER=mock to use labelled demo payments.',
      });
    }
    if (env.PAYMENT_PROVIDER === 'midtrans' && !env.MIDTRANS_SIGNATURE_SECRET_KEY.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MIDTRANS_SIGNATURE_SECRET_KEY'],
        message:
          'PAYMENT_PROVIDER=midtrans needs MIDTRANS_SIGNATURE_SECRET_KEY to verify payment notifications. Midtrans dashboard (Sandbox) > Settings > Access Keys > Signature Secret Key (click the eye icon).',
      });
    }
    if (env.MIDTRANS_IS_PRODUCTION === 'true') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['MIDTRANS_IS_PRODUCTION'], message: 'This prototype only supports the Midtrans sandbox.' });
    }
  });

export type Env = z.infer<typeof schema> & { apiPublicUrl: string; midtransSignatureKeys: string[] };

export function loadEnv(): Env {
  loadDotenv();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Never print values here: they may be secrets.
    throw new Error(`Invalid environment configuration:\n${lines}\nSee .env.example for every variable and where to get it.`);
  }
  return {
    ...parsed.data,
    apiPublicUrl: parsed.data.API_PUBLIC_URL ?? `http://localhost:${parsed.data.API_PORT}`,
    midtransSignatureKeys: parsed.data.MIDTRANS_SIGNATURE_SECRET_KEY.split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  };
}
