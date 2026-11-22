import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { ENV } from './config/config.module';
import type { Env } from './config/env';

async function main() {
  // rawBody keeps the exact request bytes, needed to verify HMAC signatures.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  const env = app.get<Env>(ENV);
  await app.listen(env.API_PORT);
  const log = new Logger('TicketPay');
  log.log(`API listening on http://localhost:${env.API_PORT}`);
  log.log(`Payments: ${env.PAYMENT_PROVIDER} (sandbox or mock only). Blockchain: ${env.CHAIN_MODE}.`);
}

main().catch((err) => {
  // Configuration errors are printed without stack noise so the fix is obvious.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
