import { Module } from '@nestjs/common';
import { PAYMENT_METHODS, type PaymentMethod } from '@ticketpay/shared';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { MerchantSettingsController, MerchantsController } from '../merchants/merchant-settings.controller';
import { WebhookWorker } from '../merchant-webhooks/webhook-worker';
import { OrdersController } from '../orders/orders.controller';
import { OrdersService } from '../orders/orders.service';
import { DevController } from '../webhooks/dev.controller';
import { MidtransWebhookController } from '../webhooks/midtrans-webhook.controller';
import { FeesService } from './fees.service';
import { PaymentActorResolver } from './payment-actor';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { MidtransPaymentProvider } from './providers/midtrans.provider';
import { MockPaymentProvider } from './providers/mock.provider';
import { PAYMENT_PROVIDER } from './providers/provider';

/** Chooses the payment adapter from PAYMENT_PROVIDER. The mock is never used when Midtrans is configured. */
export function providerFactory(env: Env) {
  if (env.PAYMENT_PROVIDER === 'midtrans') {
    const enabled = env.MIDTRANS_ENABLED_METHODS.split(',')
      .map((m) => m.trim().toUpperCase())
      .filter((m): m is PaymentMethod => (PAYMENT_METHODS as readonly string[]).includes(m));
    return new MidtransPaymentProvider({
      serverKey: env.MIDTRANS_SERVER_KEY,
      snapUrl: env.MIDTRANS_SNAP_URL,
      apiUrl: env.MIDTRANS_API_URL,
      webOrigin: env.WEB_ORIGIN,
      enabledMethods: enabled.length ? enabled : [...PAYMENT_METHODS],
    });
  }
  return new MockPaymentProvider(env.WEB_ORIGIN);
}

@Module({
  controllers: [OrdersController, PaymentsController, MidtransWebhookController, DevController, MerchantSettingsController, MerchantsController],
  providers: [
    FeesService,
    OrdersService,
    PaymentsService,
    PaymentActorResolver,
    WebhookWorker,
    { provide: PAYMENT_PROVIDER, inject: [ENV], useFactory: providerFactory },
  ],
  exports: [PaymentsService, WebhookWorker],
})
export class PaymentsModule {}
