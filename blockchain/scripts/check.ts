// Pre-flight check before deploying to Sepolia. Sends nothing, costs nothing.
//   pnpm chain:check:sepolia
// Prints the deployer and signer addresses (never the keys), their balances, and anything missing.
import { ethers, network } from 'hardhat';
import { normalizeKey } from '../hardhat.config';

const MIN_DEPLOYER = ethers.parseEther('0.01');
const MIN_SIGNER = ethers.parseEther('0.005');

async function main() {
  const problems: string[] = [];
  const env = process.env;
  if (!env.SEPOLIA_RPC_URL?.trim()) problems.push('SEPOLIA_RPC_URL is empty');
  const deployerKey = normalizeKey(env.DEPLOYER_PRIVATE_KEY);
  const signerKey = normalizeKey(env.SIGNER_PRIVATE_KEY);
  if (!deployerKey) problems.push('DEPLOYER_PRIVATE_KEY is empty');
  if (!signerKey) problems.push('SIGNER_PRIVATE_KEY is empty');
  if (!env.CUSTODIAL_MASTER_SECRET || env.CUSTODIAL_MASTER_SECRET.length < 32) problems.push('CUSTODIAL_MASTER_SECRET is missing or shorter than 32 characters (run pnpm secrets)');
  if (problems.length) return finish(problems);

  let deployer: string, signer: string;
  try {
    deployer = new ethers.Wallet(deployerKey!).address;
    signer = new ethers.Wallet(signerKey!).address;
  } catch {
    return finish(['A private key is not valid: it must be 64 hex characters, with or without 0x']);
  }
  if (deployer === signer) problems.push('Deployer and signer are the same wallet. Use two separate test wallets.');

  const chainId = Number(await ethers.provider.send('eth_chainId', []));
  console.log(`RPC       ${network.name}, chain ${chainId}`);
  if (chainId !== 11155111) problems.push(`The RPC is on chain ${chainId}, not Sepolia (11155111). Never point this at mainnet.`);

  const [deployerBal, signerBal] = await Promise.all([ethers.provider.getBalance(deployer), ethers.provider.getBalance(signer)]);
  console.log(`Deployer  ${deployer}  ${ethers.formatEther(deployerBal)} SepoliaETH`);
  console.log(`Signer    ${signer}  ${ethers.formatEther(signerBal)} SepoliaETH`);
  if (deployerBal < MIN_DEPLOYER) problems.push(`Deployer has less than ${ethers.formatEther(MIN_DEPLOYER)} SepoliaETH. Get some from a faucet.`);
  if (signerBal < MIN_SIGNER) problems.push(`Signer has less than ${ethers.formatEther(MIN_SIGNER)} SepoliaETH. It pays for every mint.`);
  if (env.TICKET_CONTRACT_ADDRESS) console.log(`Contract  ${env.TICKET_CONTRACT_ADDRESS} (already set in .env)`);
  finish(problems);
}

function finish(problems: string[]) {
  if (problems.length) {
    console.log('\nNot ready yet:');
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('\nReady. Next: pnpm chain:deploy:sepolia');
  }
}

main().catch((err) => {
  console.error(`Check failed: ${(err as Error).message}`);
  process.exitCode = 1;
});
