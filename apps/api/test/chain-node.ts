// Starts a throwaway Hardhat node and deploys TicketPayTicket from the exported artifact,
// the same way scripts/deploy.ts does: admin = account #0, operational roles to account #1.
import { TicketPayTicketArtifact } from '@ticketpay/contracts';
import { ContractFactory, JsonRpcProvider, NonceManager, Wallet, type Contract, type InterfaceAbi } from 'ethers';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

// Hardhat's public test accounts. Funded only on a local Hardhat node.
export const HARDHAT_KEYS = {
  admin: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  signer: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  outsider: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
};

export interface ChainNode {
  rpcUrl: string;
  provider: JsonRpcProvider;
  address: string;
  /** The contract, connected as the admin account. */
  contract: Contract;
  stop: () => Promise<void>;
}

export async function startChainNode(port = 18545): Promise<ChainNode> {
  const dir = resolve(__dirname, '../../../blockchain');
  const child: ChildProcess = spawn(resolve(dir, 'node_modules/.bin/hardhat'), ['node', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (d) => (output += d.toString()));
  child.stderr?.on('data', (d) => (output += d.toString()));
  const rpcUrl = `http://127.0.0.1:${port}`;
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true });

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await provider.getBlockNumber();
      break;
    } catch {
      if (child.exitCode !== null || Date.now() > deadline) {
        child.kill();
        throw new Error(`Hardhat node did not start:\n${output.slice(-2000)}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const admin = new NonceManager(new Wallet(HARDHAT_KEYS.admin, provider));
  const factory = new ContractFactory(TicketPayTicketArtifact.abi as InterfaceAbi, TicketPayTicketArtifact.bytecode, admin);
  const deployed = await factory.deploy(await admin.getAddress());
  await deployed.waitForDeployment();
  const contract = deployed as unknown as Contract;
  const signer = new Wallet(HARDHAT_KEYS.signer).address;
  // DEFAULT_ADMIN_ROLE too, as the local deploy script grants it, so refunds can cancel tokens.
  for (const role of ['MINTER_ROLE', 'GATE_ROLE', 'EVENT_MANAGER_ROLE', 'DEFAULT_ADMIN_ROLE']) {
    const tx = await contract.getFunction('grantRole')(await contract.getFunction(role)(), signer);
    await tx.wait();
  }

  return {
    rpcUrl,
    provider,
    address: await deployed.getAddress(),
    contract,
    stop: async () => {
      provider.destroy();
      // A process killed by a signal has a null exitCode, so check both.
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((r) => child.once('exit', r));
        child.kill('SIGTERM');
        await exited;
      }
    },
  };
}
