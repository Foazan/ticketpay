// Prints fresh random values for the three local secrets in .env.
import { randomBytes } from 'node:crypto';
for (const name of ['JWT_SECRET', 'WEBHOOK_SECRET_ENC_KEY', 'CUSTODIAL_MASTER_SECRET']) {
  console.log(`${name}=${randomBytes(32).toString('hex')}`);
}
