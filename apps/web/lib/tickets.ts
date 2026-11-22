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
};

export type TicketRow = {
  id: string;
  status: string;
  mintStatus: 'PENDING' | 'SUBMITTED' | 'MINTED' | 'FAILED';
  tokenId: string | null;
  eventTitle: string;
  eventSlug: string;
  eventStartAt: string;
  venue: string;
  city: string;
  posterPath: string;
  tierName: string;
  chain: ChainRecord;
};

export type TicketDetail = TicketRow & { holderName: string; paymentRefHash: string; onChainEventId: number; tierCode: number; seq: number };

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
