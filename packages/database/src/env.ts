import { config } from 'dotenv';
import { resolve } from 'node:path';

// Loads the repository root .env when a script is run from this package.
config({ path: resolve(__dirname, '../../../.env') });

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env at the repository root and fill it in.');
  }
  return url;
}
