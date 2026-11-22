import { Body, Controller, HttpCode, Inject, Ip, Logger, Post, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SkipCsrf } from '../auth/guards';
import { Public } from '../common/decorators';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PaymentsService } from '../payments/payments.service';
import { verifyMidtransSignature } from '../payments/providers/midtrans.provider';
import { ProviderUnavailableError } from '../payments/providers/provider';
import { mapMidtransStatus } from '../payments/state-machine';

type MidtransNotification = Record<string, unknown> & {
  order_id?: string;
  status_code?: string;
  gross_amount?: string;
  signature_key?: string;
  transaction_status?: string;
  fraud_status?: string;
  payment_type?: string;
  transaction_id?: string;
};

/** Fields worth keeping. Signature, VA numbers, card data and customer details are dropped. */
const KEEP = ['order_id', 'transaction_status', 'status_code', 'fraud_status', 'gross_amount', 'payment_type', 'transaction_id', 'transaction_time', 'settlement_time', 'currency'];
export const redactMidtrans = (body: Record<string, unknown>) =>
  Object.fromEntries(KEEP.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

/**
 * Midtrans HTTP notification endpoint. A notification is trusted only after its signature checks out,
 * and (by default) after Midtrans' Get Status API confirms the status. The frontend's redirect after
 * payment is never treated as proof of payment.
 */
@Public()
@SkipCsrf()
@SkipThrottle()
@Controller('v1/webhooks')
export class MidtransWebhookController {
  private readonly log = new Logger('MidtransWebhook');

  constructor(
    private readonly payments: PaymentsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('midtrans')
  @HttpCode(200)
  async handle(@Body() body: MidtransNotification, @Ip() ip: string) {
    if (!this.env.MIDTRANS_SERVER_KEY) {
      throw new ServiceUnavailableException('Midtrans is not configured on this server');
    }
    const required = ['order_id', 'status_code', 'gross_amount', 'signature_key', 'transaction_status'] as const;
    if (required.some((k) => typeof body?.[k] !== 'string' || body[k] === '')) {
      await this.payments.recordRejected('MIDTRANS', redactMidtrans(body ?? {}), 'missing fields', ip);
      throw new UnauthorizedException('Invalid notification');
    }
    if (!verifyMidtransSignature(body as Required<typeof body>, this.env.MIDTRANS_SERVER_KEY)) {
      this.log.warn(`Rejected notification with an invalid signature for order_id ${body.order_id}`);
      await this.payments.recordRejected('MIDTRANS', redactMidtrans(body), 'invalid signature', ip);
      throw new UnauthorizedException('Invalid signature');
    }

    let status = {
      transactionStatus: body.transaction_status!,
      statusCode: body.status_code!,
      fraudStatus: body.fraud_status ?? null,
      grossAmount: body.gross_amount!,
      paymentType: body.payment_type ?? null,
      transactionId: body.transaction_id ?? null,
    };
    if (this.env.MIDTRANS_VERIFY_STATUS === 'true') {
      try {
        const confirmed = await this.payments.provider.getStatus(body.order_id!);
        if (confirmed) status = confirmed;
      } catch (err) {
        if (err instanceof ProviderUnavailableError) {
          // A non-2xx makes Midtrans retry later, when the status API may be reachable again.
          throw new ServiceUnavailableException('Could not confirm the status with Midtrans; please retry');
        }
        throw err;
      }
    }

    const result = await this.payments.applyUpdate({
      provider: 'MIDTRANS',
      source: 'MIDTRANS',
      reference: body.order_id!,
      providerStatus: status.transactionStatus,
      target: mapMidtransStatus(status.transactionStatus, status.fraudStatus),
      dedupeKey: `MIDTRANS:${body.order_id}:${status.transactionStatus}:${status.statusCode}:${status.fraudStatus ?? ''}`,
      grossAmount: status.grossAmount,
      paymentType: status.paymentType,
      transactionId: status.transactionId,
      payload: redactMidtrans(body),
    });
    return { received: true, outcome: result.outcome };
  }
}
