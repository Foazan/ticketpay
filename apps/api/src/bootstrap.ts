import type { INestApplication } from '@nestjs/common';
import { CSRF_HEADER } from '@ticketpay/shared';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ENV } from './config/config.module';
import type { Env } from './config/env';

/** Shared by main.ts and the tests so both run the same middleware. */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  // In same-origin mode the web app forwards browser requests from this machine. Trusting only a
  // loopback proxy lets rate limits see each visitor's address from X-Forwarded-For, while a header
  // sent by anyone else is ignored.
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', CSRF_HEADER, 'idempotency-key', 'authorization'],
    exposedHeaders: ['idempotent-replayed'],
  });
  app.enableShutdownHooks();
}
