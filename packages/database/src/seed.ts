import { createDatabase } from './client';
import { databaseUrl } from './env';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, seedDatabase } from './seed-fn';

async function main() {
  const { db, pool } = createDatabase(databaseUrl());
  const result = await seedDatabase(db);
  await pool.end();
  console.log(`Seeded ${result.users} users, ${result.merchants} merchants, ${result.events} events, ${result.tiers} ticket tiers.`);
  console.log(`Demo accounts (password for all: ${DEMO_PASSWORD}):`);
  for (const a of DEMO_ACCOUNTS) console.log(`  ${a.role.padEnd(10)} ${a.email}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
