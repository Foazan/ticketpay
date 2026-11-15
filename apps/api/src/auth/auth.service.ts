import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { merchants, users } from '@ticketpay/database';
import type { LoginInput, RegisterInput, RegisterOrganizerInput, SessionUser } from '@ticketpay/shared';
import * as argon2 from 'argon2';
import { and, eq, isNull } from 'drizzle-orm';
import * as jwt from 'jsonwebtoken';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB, type Database } from '../db/db.module';

export const SESSION_COOKIE = 'tp_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // Verified against when the email is unknown, so response time does not reveal which emails exist.
  private dummyHash?: Promise<string>;
  private getDummyHash(): Promise<string> {
    this.dummyHash ??= argon2.hash('ticketpay-unknown-account', { type: argon2.argon2id });
    return this.dummyHash;
  }

  private isUniqueViolation(err: unknown): boolean {
    const e = err as { code?: string; cause?: { code?: string } };
    return e?.code === '23505' || e?.cause?.code === '23505';
  }

  async register(input: RegisterInput): Promise<SessionUser> {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      const [row] = await this.db
        .insert(users)
        .values({ email: input.email, fullName: input.fullName, phone: input.phone, passwordHash, role: 'BUYER' })
        .returning({ id: users.id });
      return this.sessionUser(row.id);
    } catch (err) {
      if (this.isUniqueViolation(err)) throw new ConflictException('An account with this email already exists');
      throw err;
    }
  }

  async registerOrganizer(input: RegisterOrganizerInput): Promise<SessionUser> {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      const userId = await this.db.transaction(async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({ email: input.email, fullName: input.fullName, phone: input.phone, passwordHash, role: 'ORGANIZER' })
          .returning({ id: users.id });
        await tx.insert(merchants).values({
          userId: u.id,
          businessName: input.businessName,
          organizerType: input.organizerType,
          contactPerson: input.contactPerson,
          phone: input.phone,
          address: input.address,
          description: input.description,
          settlementAccountNote: input.settlementAccountNote,
          status: 'PENDING',
        });
        return u.id;
      });
      return this.sessionUser(userId);
    } catch (err) {
      if (this.isUniqueViolation(err)) throw new ConflictException('An account with this email already exists');
      throw err;
    }
  }

  async login(input: LoginInput): Promise<SessionUser> {
    const [row] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.email, input.email), isNull(users.deletedAt)))
      .limit(1);
    const ok = await argon2.verify(row?.passwordHash ?? (await this.getDummyHash()), input.password).catch(() => false);
    if (!row || !ok) throw new UnauthorizedException('Email or password is incorrect');
    return this.sessionUser(row.id);
  }

  /** Loads the current user and merchant from the database. Throws 401 if the account no longer exists. */
  async sessionUser(userId: string): Promise<SessionUser> {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        merchantId: merchants.id,
        businessName: merchants.businessName,
        merchantStatus: merchants.status,
      })
      .from(users)
      .leftJoin(merchants, and(eq(merchants.userId, users.id), isNull(merchants.deletedAt)))
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!row) throw new UnauthorizedException('Session is no longer valid');
    return {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      role: row.role,
      merchant: row.merchantId ? { id: row.merchantId, businessName: row.businessName!, status: row.merchantStatus! } : null,
    };
  }

  signSession(userId: string): string {
    return jwt.sign({ sub: userId }, this.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: SESSION_TTL_SECONDS });
  }

  /** Returns the user id from a session token, or null if the token is missing, expired or forged. */
  verifySession(token: string | undefined): string | null {
    if (!token) return null;
    try {
      const payload = jwt.verify(token, this.env.JWT_SECRET, { algorithms: ['HS256'] });
      return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
