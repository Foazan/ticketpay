// Sends Sepolia test ETH from the deployer wallet to the signer wallet, so only one faucet claim is needed.
//   pnpm chain:fund-signer            (sends 0.02)
//   FUND_AMOUNT=0.01 pnpm chain:fund-signer
// Testnet only: refuses to run on any chain other than Sepolia.
import { ethers, network } from 'hardhat';
import { normalizeKey } from '../hardhat.config';

async function main() {
  const chainId = Number(await ethers.provider.send('eth_chainId', []));
  if (chainId !== 11155111) throw new Error(`Refusing to send: chain ${chainId} is not Sepolia.`);
  const signerKey = normalizeKey(process.env.SIGNER_PRIVATE_KEY);
  if (!signerKey) throw new Error('SIGNER_PRIVATE_KEY is empty in .env');
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('DEPLOYER_PRIVATE_KEY is empty in .env');
  const to = new ethers.Wallet(signerKey).address;
  if (to === deployer.address) throw new Error('Deployer and signer are the same wallet. Use two separate test wallets.');

  const amount = ethers.parseEther(process.env.FUND_AMOUNT || '0.02');
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`From deployer ${deployer.address} (${ethers.formatEther(balance)} SepoliaETH)`);
  console.log(`To signer     ${to}`);
  if (balance < amount + ethers.parseEther('0.005')) throw new Error('The deployer needs at least the amount plus 0.005 SepoliaETH left over for deploying.');

  const tx = await deployer.sendTransaction({ to, value: amount });
  console.log(`Sending ${ethers.formatEther(amount)} SepoliaETH: https://sepolia.etherscan.io/tx/${tx.hash}`);
  await tx.wait();
  console.log(`Done. Signer balance: ${ethers.formatEther(await ethers.provider.getBalance(to))} SepoliaETH (${network.name})`);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
