import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ChainClient } from '../chain/chain.client';
import { Public } from '../common/decorators';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database } from '../db/db.module';

@Public()
@Controller('v1/health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly chain: ChainClient,
  ) {}

  @Get()
  async health() {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException('Database is not reachable. Is PostgreSQL running? Try "pnpm infra:up".');
    }
    // Modes are reported so the UI can label sandbox and testnet behaviour.
    // The chain is reported but never fails the health check: tickets still issue off-chain while it is down.
    return { status: 'ok', paymentProvider: this.env.PAYMENT_PROVIDER, chainMode: this.env.CHAIN_MODE, chain: await this.chain.status() };
  }
}
