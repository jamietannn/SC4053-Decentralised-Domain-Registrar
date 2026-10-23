export enum Phase {
  None,
  Commit,
  Reveal,
  Settlement,
  Settled,
  Closed,
}

export enum Ineligibility {
  None,
  BelowMinimum,
  InvalidDomain,
  WrongDomain,
}

export const PHASE_LABEL: Record<Phase, string> = {
  [Phase.None]: "Not started",
  [Phase.Commit]: "Commit phase",
  [Phase.Reveal]: "Reveal phase",
  [Phase.Settlement]: "Settlement",
  [Phase.Settled]: "Settled",
  [Phase.Closed]: "Closed",
};

export const INELIGIBILITY_LABEL: Record<Ineligibility, string> = {
  [Ineligibility.None]: "Eligible",
  [Ineligibility.BelowMinimum]: "Bid below the minimum",
  [Ineligibility.InvalidDomain]: "Invalid domain format",
  [Ineligibility.WrongDomain]: "Domain does not match this auction",
};

export interface RegistryConfig {
  deposit: bigint;
  minBid: bigint;
  commitDuration: number;
  revealDuration: number;
  settlementDuration: number;
  treasury: string;
}

export interface AuctionInfo {
  id: bigint;
  nameHash: string;
  starter: string;
  commitDeadline: number;
  revealDeadline: number;
  commitCount: number;
  revealCount: number;
  eligibleCount: number;
  ineligibleCount: number;
  settled: boolean;
  finalised: boolean;
  winner: string;
  winningBid: bigint;
  /** Set on-chain by the first eligible reveal; empty before that. */
  domain: string;
  phase: Phase;
}

export interface BidInfo {
  commitment: string;
  commitIndex: number;
  revealed: boolean;
  eligible: boolean;
  reason: Ineligibility;
  withdrawn: boolean;
  amount: bigint;
}

export interface RankInfo {
  rank: number;
  windowStart: number;
  windowEnd: number;
}

export interface DomainLookup {
  domain: string;
  nameHash: string;
  owner: string | null;
  /** The latest unsettled, unfinalised auction for this domain, if any (may already be Closed). */
  auction: AuctionInfo | null;
}

export interface OwnedName {
  domain: string;
  isPrimary: boolean;
  resolvedAddress: string;
  price: bigint | null;
  registeredAt: number | null;
}

export interface MyAuction {
  auction: AuctionInfo;
  bid: BidInfo;
  /** Plaintext domain if known (on-chain after an eligible reveal, or remembered locally). */
  domain: string | null;
}

export interface HistoryItem {
  key: string;
  label: string;
  detail?: string;
  txHash: string;
  blockNumber: number;
  timestamp: number | null;
  /** Positive = ETH received by the user, negative = ETH paid by the user. */
  amountWei?: bigint;
}

/** Read-only view of the registrar; implemented by the live chain and by demo data. */
export interface Registry {
  readonly demo: boolean;
  config(): Promise<RegistryConfig>;
  blockNumber(): Promise<number>;
  lookup(domain: string): Promise<DomainLookup>;
  auction(id: bigint): Promise<AuctionInfo>;
  bid(id: bigint, bidder: string): Promise<BidInfo>;
  rank(id: bigint, bidder: string): Promise<RankInfo | null>;
  currentOfferee(id: bigint): Promise<string | null>;
  canWithdraw(id: bigint, bidder: string): Promise<boolean>;
  resolve(domain: string): Promise<string | null>;
  reverseResolve(address: string): Promise<string | null>;
  ownedNames(address: string): Promise<OwnedName[]>;
  myAuctions(address: string): Promise<MyAuction[]>;
  history(address: string): Promise<HistoryItem[]>;
}
