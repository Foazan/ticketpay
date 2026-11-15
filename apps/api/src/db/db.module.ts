import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type Database } from '@ticketpay/database';
import type { Pool } from 'pg';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export const DB = Symbol('DB');
const POOL = Symbol('POOL');
const CONNECTION = Symbol('CONNECTION');

@Injectable()
class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    { provide: CONNECTION, inject: [ENV], useFactory: (env: Env) => createDatabase(env.DATABASE_URL) },
    { provide: DB, inject: [CONNECTION], useFactory: (c: { db: Database }) => c.db },
    { provide: POOL, inject: [CONNECTION], useFactory: (c: { pool: Pool }) => c.pool },
    PoolCloser,
  ],
  exports: [DB],
})
export class DbModule {}
export type { Database };
