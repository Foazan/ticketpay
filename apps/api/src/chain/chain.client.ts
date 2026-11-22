import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { TICKET_PAY_TICKET_ABI } from '@ticketpay/contracts';
import { Contract, JsonRpcProvider, NonceManager, Wallet, computeAddress, keccak256, toUtf8Bytes, type InterfaceAbi, type TransactionReceipt, type TransactionResponse } from 'ethers';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { resolveChainConfig, type ChainConfig } from './chain.config';

export class ChainNotConfiguredError extends Error {}

export interface MintedLog {
  tokenId: bigint;
  to: string;
  eventId: bigint;
  tier: number;
  paymentRef: string;
}

/**
 * Thin wrapper over the TicketPayTicket contract. The signer key stays in this process;
 * nothing here is ever sent to the browser.
 */
@Injectable()
export class ChainClient implements OnApplicationShutdown {
  private readonly log = new Logger('Chain');
  readonly config: ChainConfig;
  private provider: JsonRpcProvider | null = null;
  private contract: Contract | null = null;
  private nonces: NonceManager | null = null;
  private signerAddress: string | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.config = resolveChainConfig(env);
    if (this.config.enabled) {
      const problem = this.configProblem();
      if (problem) this.log.warn(`CHAIN_MODE=${this.config.mode} but ${problem}. Tickets will wait as "pending" until this is fixed.`);
      else this.log.log(`${this.config.label}: contract ${this.config.contractAddress}, signer ${this.signer()}`);
    }
  }

  /** Why minting cannot run, or null when the configuration is complete. */
  configProblem(): string | null {
    if (!this.config.enabled) return 'CHAIN_MODE is disabled';
    if (!this.config.rpcUrl) return 'no RPC URL is set';
    if (!this.config.signerKey) return 'SIGNER_PRIVATE_KEY is not set';
    if (!this.config.contractAddress)
      return `no contract address: set TICKET_CONTRACT_ADDRESS or run "pnpm chain:deploy:${this.config.mode === 'sepolia' ? 'sepolia' : 'local'}"`;
    return null;
  }

  /**
   * The buyer's custodial address. Derived from a server-side secret and the user id, so it is
   * stable without storing a private key. Transfers are disabled on-chain, so the key is never needed.
   */
  custodialAddress(userId: string): string {
    if (!this.env.CUSTODIAL_MASTER_SECRET) throw new ChainNotConfiguredError('CUSTODIAL_MASTER_SECRET is not set');
    return computeAddress(keccak256(toUtf8Bytes(`${this.env.CUSTODIAL_MASTER_SECRET}:${userId}`)));
  }

  signer(): string | null {
    if (!this.config.signerKey) return null;
    this.signerAddress ??= new Wallet(this.config.signerKey).address;
    return this.signerAddress;
  }

  private ticket(): Contract {
    const problem = this.configProblem();
    if (problem) throw new ChainNotConfiguredError(problem);
    if (!this.contract) {
      // A static network stops ethers from probing (and log-spamming) when the node is down.
      this.provider = new JsonRpcProvider(this.config.rpcUrl, this.config.chainId ?? undefined, { staticNetwork: true });
      // A local node mines instantly, so poll fast there; Sepolia blocks come every ~12 s.
      this.provider.pollingInterval = this.config.mode === 'local' ? 200 : 4000;
      // Nonces are counted locally: ethers briefly caches eth_getTransactionCount, so back-to-back sends
      // could otherwise reuse one. Safe because only this worker (concurrency 1) sends from the signer.
      this.nonces = new NonceManager(new Wallet(this.config.signerKey!, this.provider));
      this.contract = new Contract(this.config.contractAddress!, TICKET_PAY_TICKET_ABI as InterfaceAbi, this.nonces);
    }
    return this.contract;
  }

  private rpc(): JsonRpcProvider {
    this.ticket();
    return this.provider!;
  }

  async status() {
    const base = {
      mode: this.config.mode,
      network: this.config.label,
      chainId: this.config.chainId,
      contractAddress: this.config.contractAddress,
      contractUrl: this.config.contractAddress ? this.config.explorerAddressUrl(this.config.contractAddress) : null,
      signer: this.signer(),
    };
    if (!this.config.enabled) return { ...base, ready: false, problem: null };
    const problem = this.configProblem();
    if (problem) return { ...base, ready: false, problem };
    try {
      const provider = this.rpc();
      const [network, blockNumber, code] = await Promise.all([
        provider.send('eth_chainId', []) as Promise<string>,
        provider.getBlockNumber(),
        provider.getCode(this.config.contractAddress!),
      ]);
      const chainId = Number(network);
      if (chainId !== this.config.chainId) return { ...base, ready: false, problem: `RPC reports chain ${chainId}, expected ${this.config.chainId}` };
      if (code === '0x') return { ...base, ready: false, problem: 'No contract at that address on this chain. Deploy it again.' };
      return { ...base, ready: true, problem: null, blockNumber };
    } catch (err) {
      return { ...base, ready: false, problem: `RPC not reachable: ${(err as Error).message.slice(0, 120)}` };
    }
  }

  async tokenIdByPaymentRef(paymentRef: string): Promise<bigint> {
    return (await this.ticket().getFunction('tokenIdByPaymentRef')(paymentRef)) as bigint;
  }

  async maxSupply(eventId: number): Promise<bigint> {
    return (await this.ticket().getFunction('maxSupply')(eventId)) as bigint;
  }

  async ownerOf(tokenId: bigint): Promise<string> {
    return (await this.ticket().getFunction('ownerOf')(tokenId)) as string;
  }

  async ticketStatus(tokenId: bigint): Promise<number> {
    return Number(await this.ticket().getFunction('ticketStatus')(tokenId));
  }

  sendSetEventSupply(eventId: number, max: number): Promise<TransactionResponse> {
    return this.send(() => this.ticket().getFunction('setEventSupply')(eventId, max) as Promise<TransactionResponse>);
  }

  sendMint(to: string, eventId: number, tier: number, paymentRef: string): Promise<TransactionResponse> {
    return this.send(() => this.ticket().getFunction('mintTicket')(to, eventId, tier, paymentRef) as Promise<TransactionResponse>);
  }

  /** After any failed send the local nonce may be ahead of the chain, so it is re-read on the next send. */
  private async send(fn: () => Promise<TransactionResponse>): Promise<TransactionResponse> {
    try {
      return await fn();
    } catch (err) {
      this.nonces?.reset();
      throw err;
    }
  }

  /** A short, single-line reason for logs and the transactions table. */
  errorText(err: unknown): string {
    const e = err as { shortMessage?: string; message?: string };
    return (this.revertName(err) ?? e.shortMessage ?? e.message ?? String(err)).slice(0, 300);
  }

  /** Waits for the configured confirmations. Returns null on timeout, so the job can retry later. */
  async waitFor(tx: TransactionResponse, timeoutMs = 180_000): Promise<TransactionReceipt | null> {
    try {
      return await tx.wait(this.config.confirmations, timeoutMs);
    } catch (err) {
      if ((err as { code?: string }).code === 'TIMEOUT') return null;
      throw err;
    }
  }

  /** Receipt of an earlier transaction: a receipt, 'pending' while still in the mempool, or 'missing' if dropped. */
  async lookup(hash: string): Promise<TransactionReceipt | 'pending' | 'missing'> {
    const provider = this.rpc();
    const receipt = await provider.getTransactionReceipt(hash);
    if (receipt) {
      if (this.config.confirmations <= 1) return receipt;
      // Read the head directly: ethers caches the block number between polls.
      const head = Number(await provider.send('eth_blockNumber', []));
      return head - receipt.blockNumber + 1 >= this.config.confirmations ? receipt : 'pending';
    }
    return (await provider.getTransaction(hash)) ? 'pending' : 'missing';
  }

  mintedLog(receipt: TransactionReceipt): MintedLog | null {
    const contract = this.ticket();
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== this.config.contractAddress!.toLowerCase()) continue;
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === 'TicketMinted') {
        return { tokenId: parsed.args[0], to: parsed.args[1], eventId: parsed.args[2], tier: Number(parsed.args[3]), paymentRef: parsed.args[4] };
      }
    }
    return null;
  }

  /** The custom error name of a reverted call, such as PaymentRefAlreadyUsed, if it can be decoded. */
  revertName(err: unknown): string | null {
    const e = err as { revert?: { name?: string }; data?: string; info?: { error?: { data?: string } } };
    if (e.revert?.name) return e.revert.name;
    const data = e.data ?? e.info?.error?.data;
    if (typeof data === 'string' && data.length >= 10 && this.contract) {
      try {
        return this.contract.interface.parseError(data)?.name ?? null;
      } catch {
        return null;
      }
    }
    return null;
  }

  onApplicationShutdown() {
    this.provider?.destroy();
  }
}
