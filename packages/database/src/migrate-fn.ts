import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import type { Database } from './client';

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: resolve(__dirname, '../migrations') });
}
