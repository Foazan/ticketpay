// Verifies the Sepolia deployment on Etherscan so anyone can read the source and the ticket records.
// Needs ETHERSCAN_API_KEY and deployments/sepolia.json from scripts/deploy.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { network, run } from 'hardhat';

async function main() {
  const record = JSON.parse(readFileSync(resolve(__dirname, `../deployments/${network.name}.json`), 'utf8'));
  await run('verify:verify', { address: record.address, constructorArguments: [record.admin] });
  console.log(`Verified: https://sepolia.etherscan.io/address/${record.address}#code`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
