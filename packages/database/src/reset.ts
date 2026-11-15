// Drops everything in the public schema. Development only.
import { sql } from 'drizzle-orm';
import { createDatabase } from './client';
import { databaseUrl } from './env';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database.');
  const { db, pool } = createDatabase(databaseUrl());
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await pool.end();
  console.log('Database reset.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
