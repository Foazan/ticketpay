/** Shape of a ticket's on-chain record as the API returns it. Contains no keys or secrets. */
export type ChainRecord = {
  enabled: boolean;
  network: string;
  chainId: number | null;
  contractAddress: string | null;
  txHash: string | null;
  txUrl: string | null;
  tokenUrl: string | null;
  contractUrl: string | null;
  ownerAddress?: string | null;
  /** Null until admitted. OFF_CHAIN when the chain is disabled. */
  redeemStatus: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'OFF_CHAIN' | null;
  redeemTxHash: string | null;
  redeemTxUrl: string | null;
};

export type TicketRow = {
  id: string;
  status: 'ACTIVE' | 'REDEEMED' | 'CANCELLED' | 'EXPIRED';
  mintStatus: 'PENDING' | 'SUBMITTED' | 'MINTED' | 'FAILED';
  tokenId: string | null;
  eventTitle: string;
  eventSlug: string;
  eventStartAt: string;
  venue: string;
  city: string;
  posterPath: string;
  eventEndAt: string;
  tierName: string;
  redeemedAt: string | null;
  chain: ChainRecord;
};

export type TicketDetail = TicketRow & { holderName: string; paymentRefHash: string; validationCode: string | null; onChainEventId: number; tierCode: number; seq: number };

/** Badge text and tone for a ticket's on-chain state. */
export function mintBadge(t: Pick<TicketRow, 'mintStatus' | 'tokenId' | 'chain'>): { label: string; tone: 'info' | 'pending' | 'neutral' } {
  if (!t.chain.enabled) return { label: 'Off-chain ticket', tone: 'neutral' };
  const where = t.chain.chainId === 11155111 ? 'Sepolia' : 'local chain';
  switch (t.mintStatus) {
    case 'MINTED':
      return { label: `NFT #${t.tokenId} on ${where}`, tone: 'info' };
    case 'SUBMITTED':
      return { label: 'Minting on-chain…', tone: 'pending' };
    case 'FAILED':
      return { label: 'On-chain record delayed', tone: 'pending' };
    default:
      return { label: 'On-chain record pending', tone: 'pending' };
  }
}

/** 0x1234…abcd */
export function shortHex(value: string, keep = 6): string {
  return value.length <= keep * 2 + 2 ? value : `${value.slice(0, keep + 2)}…${value.slice(-keep)}`;
}

/** Label and tone for the ticket's own status, as the buyer should read it. */
export function ticketStatusBadge(t: Pick<TicketRow, 'status' | 'eventEndAt'>): { label: string; tone: 'success' | 'neutral' | 'failed' } {
  if (t.status === 'REDEEMED') return { label: 'Used', tone: 'neutral' };
  if (t.status === 'CANCELLED') return { label: 'Cancelled', tone: 'failed' };
  if (t.status === 'EXPIRED' || new Date(t.eventEndAt).getTime() < Date.now()) return { label: 'Expired', tone: 'neutral' };
  return { label: 'Active', tone: 'success' };
}

/** My Tickets sections: upcoming and usable, already used, and cancelled or past. */
export function ticketGroup(t: Pick<TicketRow, 'status' | 'eventEndAt'>): 'upcoming' | 'used' | 'inactive' {
  if (t.status === 'REDEEMED') return 'used';
  if (t.status === 'ACTIVE' && new Date(t.eventEndAt).getTime() >= Date.now()) return 'upcoming';
  return 'inactive';
}

/** How far the on-chain redeem has got, for a ticket already admitted at the gate. */
export function redeemLabel(status: ChainRecord['redeemStatus']): string | null {
  switch (status) {
    case 'CONFIRMED':
      return 'Redeemed on-chain';
    case 'PENDING':
      return 'On-chain redeem pending';
    case 'FAILED':
      return 'On-chain redeem delayed, retrying';
    default:
      return null;
  }
}
