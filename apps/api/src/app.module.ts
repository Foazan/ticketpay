import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController } from './admin/admin.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard, CsrfGuard, RolesGuard } from './auth/guards';
import { ChainModule } from './chain/chain.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { EventsModule } from './events/events.module';
import { GateModule } from './gate/gate.module';
import { HealthController } from './health/health.controller';
import { MediaModule } from './media/media.module';
import { OrganizerController } from './organizer/organizer.controller';
import { OrganizerEventsService } from './organizer/organizer-events.service';
import { ReconciliationService } from './reconciliation/reconciliation.service';
import { PaymentsModule } from './payments/payments.module';
import { QueueModule } from './queue/queue.module';
import { TicketsController } from './tickets/tickets.controller';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    AuditModule,
    AuthModule,
    EventsModule,
    QueueModule,
    ChainModule,
    PaymentsModule,
    GateModule,
    MediaModule,
    // Baseline: 120 requests per minute per client. Auth routes set stricter limits.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  controllers: [HealthController, OrganizerController, TicketsController, AdminController],
  providers: [
    OrganizerEventsService,
    ReconciliationService,
    // Order matters: rate limit, CSRF, authentication, then role check.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
