import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Env } from '../config/env';

// Hardhat's well-known test account #1. Public, funded only on a local Hardhat node, never valid elsewhere.
const HARDHAT_ACCOUNT_1_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

export const SEPOLIA_CHAIN_ID = 11155111;
export const HARDHAT_CHAIN_ID = 31337;

export interface ChainConfig {
  enabled: boolean;
  mode: Env['CHAIN_MODE'];
  /** Name of the deployments file and of the Hardhat network: localhost or sepolia. */
  network: 'localhost' | 'sepolia' | null;
  label: string;
  rpcUrl: string;
  chainId: number | null;
  contractAddress: string | null;
  /** Where the contract address came from, for the health check. */
  addressSource: 'env' | 'deployments' | null;
  signerKey: string | null;
  confirmations: number;
  explorerTxUrl: (hash: string) => string | null;
  explorerAddressUrl: (address: string) => string | null;
  explorerTokenUrl: (address: string, tokenId: string) => string | null;
}

/** Reads blockchain/deployments/<network>.json by walking up from the working directory. */
function readDeployment(network: string): { address: string; chainId: number } | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const file = join(dir, 'blockchain', 'deployments', `${network}.json`);
    if (existsSync(file)) {
      try {
        const record = JSON.parse(readFileSync(file, 'utf8'));
        return typeof record.address === 'string' ? { address: record.address, chainId: Number(record.chainId) } : null;
      } catch {
        return null;
      }
    }
    dir = dirname(dir);
  }
  return null;
}

export function resolveChainConfig(env: Env): ChainConfig {
  const none = () => null;
  if (env.CHAIN_MODE === 'disabled') {
    return {
      enabled: false,
      mode: 'disabled',
      network: null,
      label: 'Off-chain only',
      rpcUrl: '',
      chainId: null,
      contractAddress: null,
      addressSource: null,
      signerKey: null,
      confirmations: env.CHAIN_CONFIRMATIONS,
      explorerTxUrl: none,
      explorerAddressUrl: none,
      explorerTokenUrl: none,
    };
  }
  const sepolia = env.CHAIN_MODE === 'sepolia';
  const network = sepolia ? 'sepolia' : 'localhost';
  const deployment = env.TICKET_CONTRACT_ADDRESS ? null : readDeployment(network);
  const contractAddress = env.TICKET_CONTRACT_ADDRESS || deployment?.address || null;
  return {
    enabled: true,
    mode: env.CHAIN_MODE,
    network,
    label: sepolia ? 'Ethereum Sepolia testnet' : 'Local Hardhat chain',
    rpcUrl: sepolia ? env.SEPOLIA_RPC_URL : env.LOCAL_RPC_URL,
    chainId: sepolia ? SEPOLIA_CHAIN_ID : HARDHAT_CHAIN_ID,
    contractAddress,
    addressSource: env.TICKET_CONTRACT_ADDRESS ? 'env' : deployment ? 'deployments' : null,
    signerKey: env.SIGNER_PRIVATE_KEY || (sepolia ? null : HARDHAT_ACCOUNT_1_KEY),
    confirmations: env.CHAIN_CONFIRMATIONS,
    explorerTxUrl: (hash) => (sepolia ? `https://sepolia.etherscan.io/tx/${hash}` : null),
    explorerAddressUrl: (address) => (sepolia ? `https://sepolia.etherscan.io/address/${address}` : null),
    explorerTokenUrl: (address, tokenId) => (sepolia ? `https://sepolia.etherscan.io/nft/${address}/${tokenId}` : null),
  };
}
