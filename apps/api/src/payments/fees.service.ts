import { Inject, Injectable } from '@nestjs/common';
import { platformFeeSettings } from '@ticketpay/database';
import { desc, lte } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';

@Injectable()
export class FeesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** The service fee rate in force now, in basis points. 0 if an administrator never set one. */
  async currentRateBps(at = new Date()): Promise<number> {
    const [row] = await this.db
      .select({ feeRateBps: platformFeeSettings.feeRateBps })
      .from(platformFeeSettings)
      .where(lte(platformFeeSettings.effectiveFrom, at))
      .orderBy(desc(platformFeeSettings.effectiveFrom))
      .limit(1);
    return row?.feeRateBps ?? 0;
  }
}
