import { Inject, Injectable, Logger } from '@nestjs/common';
import { auditLogs } from '@ticketpay/database';
import { DB, type Database } from '../db/db.module';

export interface AuditEntry {
  actorId?: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Writes an audit row. Never pass passwords, tokens, keys or payment credentials in metadata. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        actorId: entry.actorId ?? null,
        actorRole: entry.actorRole,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ?? null,
        ipAddress: entry.ipAddress ?? null,
      });
    } catch (err) {
      // An audit failure must not break the request, but it must be visible.
      this.logger.error(`Failed to write audit log for ${entry.action}`, err instanceof Error ? err.stack : undefined);
    }
  }
}
