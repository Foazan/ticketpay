// Deploys TicketPayTicket and gives the backend signer its three operational roles.
//   pnpm --filter @ticketpay/contracts deploy:local     (needs `pnpm chain:node` running)
//   pnpm --filter @ticketpay/contracts deploy:sepolia   (needs SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, SIGNER_PRIVATE_KEY)
// Writes deployments/<network>.json, which the API reads when TICKET_CONTRACT_ADDRESS is empty.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers, network } from 'hardhat';

async function main() {
  const [deployer, localSecond] = await ethers.getSigners();
  if (!deployer) throw new Error('No deployer account. For Sepolia set DEPLOYER_PRIVATE_KEY in .env.');

  // The backend signer: an explicit key, or Hardhat's second test account on a local chain.
  let signerAddress: string;
  if (process.env.SIGNER_PRIVATE_KEY) signerAddress = new ethers.Wallet(process.env.SIGNER_PRIVATE_KEY).address;
  else if (network.name === 'localhost' || network.name === 'hardhat') signerAddress = localSecond.address;
  else throw new Error('Set SIGNER_PRIVATE_KEY in .env: the backend wallet that will mint and redeem.');

  const { chainId } = await ethers.provider.getNetwork();
  console.log(`Network ${network.name} (chain ${chainId})`);
  console.log(`Deployer (admin) ${deployer.address}, balance ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  const contract = await ethers.deployContract('TicketPayTicket', [deployer.address]);
  const deployTx = contract.deploymentTransaction();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const receipt = await deployTx?.wait();
  console.log(`TicketPayTicket deployed at ${address} (tx ${deployTx?.hash})`);

  for (const role of ['MINTER_ROLE', 'GATE_ROLE', 'EVENT_MANAGER_ROLE'] as const) {
    const roleId = await contract[role]();
    if (await contract.hasRole(roleId, signerAddress)) continue;
    const tx = await contract.grantRole(roleId, signerAddress);
    await tx.wait();
    console.log(`Granted ${role} to signer ${signerAddress}`);
  }

  const record = {
    network: network.name,
    chainId: Number(chainId),
    address,
    deployTxHash: deployTx?.hash ?? null,
    deployBlock: receipt?.blockNumber ?? null,
    admin: deployer.address,
    signer: signerAddress,
    deployedAt: new Date().toISOString(),
  };
  const dir = resolve(__dirname, '../deployments');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${network.name}.json`), JSON.stringify(record, null, 2) + '\n');
  console.log(`Wrote deployments/${network.name}.json`);
  if (network.name === 'sepolia') {
    console.log(`Etherscan: https://sepolia.etherscan.io/address/${address}`);
    console.log('Set TICKET_CONTRACT_ADDRESS in .env to this address, then run `pnpm --filter @ticketpay/contracts verify:sepolia`.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
