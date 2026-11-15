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

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters. Run "pnpm secrets" and paste the output into .env'),
  PAYMENT_PROVIDER: z.enum(['mock', 'midtrans']).default('mock'),
  CHAIN_MODE: z.enum(['disabled', 'local', 'sepolia']).default('disabled'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(): Env {
  loadDotenv();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Never print values here: they may be secrets.
    throw new Error(`Invalid environment configuration:\n${lines}\nSee .env.example for every variable and where to get it.`);
  }
  return parsed.data;
}
