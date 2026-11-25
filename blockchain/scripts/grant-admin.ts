// Gives the backend signer the contract's admin role, so a refund can cancel(tokenId) on-chain.
//   pnpm chain:grant-admin:sepolia   (needs DEPLOYER_PRIVATE_KEY, the current admin, and SIGNER_PRIVATE_KEY)
//
// Trade-off: the admin role can also grant and revoke roles. In this prototype the signer key already
// lives in the API, so this widens what a stolen signer key could do. A production system would give
// cancel() its own narrow role instead (and keep keys in a KMS). Run it only on a test deployment.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers, network } from 'hardhat';
import { normalizeKey } from '../hardhat.config';

async function main() {
  const record = JSON.parse(readFileSync(resolve(__dirname, `../deployments/${network.name}.json`), 'utf8'));
  const signerKey = normalizeKey(process.env.SIGNER_PRIVATE_KEY);
  const signer = signerKey ? new ethers.Wallet(signerKey).address : record.signer;
  const contract = await ethers.getContractAt('TicketPayTicket', process.env.TICKET_CONTRACT_ADDRESS || record.address);
  const role = await contract.DEFAULT_ADMIN_ROLE();
  if (await contract.hasRole(role, signer)) {
    console.log(`Signer ${signer} already has DEFAULT_ADMIN_ROLE on ${await contract.getAddress()}`);
    return;
  }
  const tx = await contract.grantRole(role, signer);
  console.log(`Granting DEFAULT_ADMIN_ROLE to ${signer}: ${network.name === 'sepolia' ? `https://sepolia.etherscan.io/tx/${tx.hash}` : tx.hash}`);
  await tx.wait();
  console.log('Done. Refunds can now cancel tokens on-chain; retry any failed cancels from Admin → Blockchain.');
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
