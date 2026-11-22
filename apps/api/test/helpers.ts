// Shared setup for the end-to-end suites. Each suite boots the real Nest app on a random port
// against the ticketpay_test database and Redis database 1.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createDatabase, DEMO_PASSWORD, runMigrations, seedDatabase, type Database } from '@ticketpay/database';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@ticketpay/shared';
import IORedis from 'ioredis';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import request from 'supertest';

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://ticketpay:ticketpay@localhost:5432/ticketpay_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
  JWT_SECRET: 'test-secret-test-secret-test-secret-test-secret',
  WEBHOOK_SECRET_ENC_KEY: 'a'.repeat(64),
  PAYMENT_PROVIDER: 'mock',
  MIDTRANS_SERVER_KEY: '',
  MIDTRANS_SIGNATURE_SECRET_KEY: '',
  RUN_WORKERS: 'true',
  WEBHOOK_RETRY_BASE_MS: '50',
  WEBHOOK_MAX_ATTEMPTS: '4',
  EXPIRY_GRACE_MS: '0',
  CHAIN_MODE: 'disabled',
};

export const csrf = { [CSRF_HEADER]: CSRF_HEADER_VALUE };

export interface TestContext {
  app: INestApplication;
  baseUrl: string;
  db: Database;
  pool: Pool;
  ids: Awaited<ReturnType<typeof seedDatabase>>['ids'];
  login: (email: string) => Promise<ReturnType<typeof request.agent>>;
  close: () => Promise<void>;
}

export async function bootTestApp(overrides: Record<string, string> = {}): Promise<TestContext> {
  Object.assign(process.env, TEST_ENV, overrides);
  const redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  await redis.flushdb();
  redis.disconnect();

  const { db, pool } = createDatabase(process.env.DATABASE_URL!);
  await runMigrations(db);
  const { ids } = await seedDatabase(db);

  // Imported after the environment is set, so configuration is read with the test values.
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/bootstrap');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.listen(0);
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // One login per account: login is rate limited to 10 per minute per client.
  const sessions = new Map<string, ReturnType<typeof request.agent>>();
  const login = async (email: string) => {
    const cached = sessions.get(email);
    if (cached) return cached;
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/v1/auth/login').set(csrf).send({ email, password: DEMO_PASSWORD });
    if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    sessions.set(email, agent);
    return agent;
  };

  return {
    app,
    baseUrl,
    db,
    pool,
    ids,
    login,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/** Polls until `check` returns a truthy value or the timeout passes. */
export async function waitFor<T>(check: () => Promise<T | undefined | null | false>, timeoutMs = 10_000, label = 'condition'): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
