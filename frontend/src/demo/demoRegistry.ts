import { parseEther } from "ethers";
import { nameHash } from "../lib/domain";
import {
  AuctionInfo,
  BidInfo,
  HistoryItem,
  Ineligibility,
  MyAuction,
  OwnedName,
  Phase,
  Registry,
  RegistryConfig,
} from "../lib/types";

/** Read-only sample data for demo mode (SPEC §7). None of this is on-chain. */
export const DEMO_ACCOUNT = "0x0000000000000000000000000000000000001234";
const OTHER_ACCOUNT = "0x000000000000000000000000000000000000bEEF";

const now = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const eth = (v: string) => parseEther(v);

const config: RegistryConfig = {
  deposit: eth("0.005"),
  minBid: eth("0.005"),
  commitDuration: 180,
  revealDuration: 180,
  settlementDuration: 180,
  treasury: OTHER_ACCOUNT,
};

const owners: Record<string, string> = { javier: DEMO_ACCOUNT, data: DEMO_ACCOUNT, example3: OTHER_ACCOUNT };
const owned: OwnedName[] = [
  { domain: "javier", isPrimary: true, resolvedAddress: DEMO_ACCOUNT, price: eth("1.7"), registeredAt: now - 88 * DAY },
  { domain: "data", isPrimary: false, resolvedAddress: DEMO_ACCOUNT, price: eth("0.9"), registeredAt: now - 36 * DAY },
];

function auction(id: number, domain: string, phase: Phase, cd: number, rd: number, extra: Partial<AuctionInfo> = {}): AuctionInfo {
  return {
    id: BigInt(id),
    nameHash: nameHash(domain),
    starter: OTHER_ACCOUNT,
    commitDeadline: cd,
    revealDeadline: rd,
    commitCount: 3,
    revealCount: phase >= Phase.Settlement ? 2 : 0,
    eligibleCount: phase >= Phase.Settlement ? 2 : 0,
    ineligibleCount: 0,
    settled: phase === Phase.Settled,
    finalised: phase === Phase.Settled,
    winner: "0x0000000000000000000000000000000000000000",
    winningBid: 0n,
    domain: phase >= Phase.Settlement ? domain : "",
    phase,
    ...extra,
  };
}

function bid(amount: string, extra: Partial<BidInfo> = {}): BidInfo {
  return {
    commitment: "0x" + "ab".repeat(32),
    commitIndex: 0,
    revealed: false,
    eligible: false,
    reason: Ineligibility.None,
    withdrawn: false,
    amount: extra.revealed ? eth(amount) : 0n,
    ...extra,
  };
}

const myAuctions: MyAuction[] = [
  { domain: "example1", auction: auction(101, "example1", Phase.Commit, now + 2 * 3600, now + 4 * 3600), bid: bid("0.5") },
  { domain: "example2", auction: auction(102, "example2", Phase.Reveal, now - 600, now + 3600), bid: bid("0.3") },
  {
    domain: "blockchain",
    auction: auction(103, "blockchain", Phase.Reveal, now - 900, now + 1800),
    bid: bid("2.0", { revealed: true, eligible: true }),
  },
  {
    domain: "example4",
    auction: auction(104, "example4", Phase.Settlement, now - 2 * 3600, now - 60),
    bid: bid("1.8", { revealed: true, eligible: true }),
  },
  {
    domain: "example5",
    auction: auction(105, "example5", Phase.Settled, now - 3 * DAY, now - 3 * DAY + 180, {
      winner: OTHER_ACCOUNT,
      winningBid: eth("0.8"),
    }),
    bid: bid("0.6", { revealed: true, eligible: true, commitIndex: 1 }),
  },
];

const byId = new Map(myAuctions.map((m) => [m.auction.id.toString(), m]));
const byDomain = new Map(myAuctions.map((m) => [m.domain!, m]));

const history: HistoryItem[] = [
  { key: "d1", label: "Bid commitment (example1.ntu)", detail: "Deposit paid", txHash: "0x" + "8f2a".repeat(16), blockNumber: 5, timestamp: now - 1200, amountWei: -config.deposit },
  { key: "d2", label: "Bid revealed (blockchain.ntu)", detail: "2 ETH · eligible", txHash: "0x" + "4b71".repeat(16), blockNumber: 4, timestamp: now - 2 * DAY },
  { key: "d3", label: "Paid winning bid · registered data.ntu", detail: "Final price 0.9 ETH", txHash: "0x" + "8f7a".repeat(16), blockNumber: 3, timestamp: now - 36 * DAY, amountWei: -eth("0.895") },
  { key: "d4", label: "Deposit refunded (example5.ntu)", txHash: "0x" + "c62e".repeat(16), blockNumber: 2, timestamp: now - 3 * DAY, amountWei: config.deposit },
];

const delay = <T,>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), 150));

export function createDemoRegistry(): Registry {
  return {
    demo: true,
    config: () => delay(config),
    blockNumber: () => delay(1),
    lookup: async (domain) => {
      const owner = owners[domain] ?? null;
      const mine = byDomain.get(domain);
      const live = mine && mine.auction.phase !== Phase.Settled ? mine.auction : null;
      return delay({ domain, nameHash: nameHash(domain), owner, auction: owner ? null : live });
    },
    auction: async (id) => {
      const m = byId.get(id.toString());
      if (!m) throw new Error("Unknown demo auction");
      return delay(m.auction);
    },
    bid: async (id) => delay(byId.get(id.toString())?.bid ?? bid("0")),
    rank: async (id) => {
      const m = byId.get(id.toString());
      if (!m?.bid.eligible) return null;
      const rank = m.auction.id === 105n ? 1 : 0;
      const start = m.auction.revealDeadline + rank * config.settlementDuration;
      return delay({ rank, windowStart: start, windowEnd: start + config.settlementDuration });
    },
    currentOfferee: async (id) => delay(id === 104n ? DEMO_ACCOUNT : null),
    canWithdraw: async (id) => delay(id === 105n),
    resolve: async (domain) => delay(owners[domain] ?? null),
    reverseResolve: async (address) => delay(address === DEMO_ACCOUNT ? "javier" : null),
    ownedNames: async (address) => delay(address === DEMO_ACCOUNT ? owned : []),
    myAuctions: async (address) => delay(address === DEMO_ACCOUNT ? myAuctions : []),
    history: async (address) => delay(address === DEMO_ACCOUNT ? history : []),
  };
}
