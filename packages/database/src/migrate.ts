import { createDatabase } from './client';
import { databaseUrl } from './env';
import { runMigrations } from './migrate-fn';

async function main() {
  const { db, pool } = createDatabase(databaseUrl());
  await runMigrations(db);
  await pool.end();
  console.log('Migrations applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
