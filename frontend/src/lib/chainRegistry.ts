import { Contract, EventLog, JsonRpcProvider, Log, ZeroAddress } from "ethers";
import abi from "../generated/NtuNames.abi.json";
import { CHAIN_ID, CONTRACT_ADDRESS, DEPLOY_BLOCK, RPC_URL } from "../config";
import { fqdn, nameHash } from "./domain";
import { formatEth } from "./format";
import { knownDomain } from "./labels";
import {
  AuctionInfo,
  BidInfo,
  DomainLookup,
  HistoryItem,
  INELIGIBILITY_LABEL,
  Ineligibility,
  MyAuction,
  OwnedName,
  Phase,
  RankInfo,
  Registry,
  RegistryConfig,
} from "./types";

/** Public RPCs cap eth_getLogs ranges, so event scans are split into chunks. */
const LOG_CHUNK = 10_000;

type RawAuction = {
  id: bigint;
  nameHash: string;
  starter: string;
  commitDeadline: bigint;
  revealDeadline: bigint;
  commitCount: bigint;
  revealCount: bigint;
  eligibleCount: bigint;
  ineligibleCount: bigint;
  settled: boolean;
  finalised: boolean;
  winner: string;
  winningBid: bigint;
  domain: string;
  phase: bigint;
};

function toAuction(a: RawAuction): AuctionInfo {
  return {
    id: a.id,
    nameHash: a.nameHash,
    starter: a.starter,
    commitDeadline: Number(a.commitDeadline),
    revealDeadline: Number(a.revealDeadline),
    commitCount: Number(a.commitCount),
    revealCount: Number(a.revealCount),
    eligibleCount: Number(a.eligibleCount),
    ineligibleCount: Number(a.ineligibleCount),
    settled: a.settled,
    finalised: a.finalised,
    winner: a.winner,
    winningBid: a.winningBid,
    domain: a.domain,
    phase: Number(a.phase) as Phase,
  };
}

export function createChainRegistry(): Registry {
  const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
  const contract = new Contract(CONTRACT_ADDRESS, abi, provider);
  let configCache: Promise<RegistryConfig> | null = null;
  const blockTimes = new Map<number, number>();

  async function blockTime(blockNumber: number): Promise<number | null> {
    if (!blockTimes.has(blockNumber)) {
      const block = await provider.getBlock(blockNumber);
      if (!block) return null;
      blockTimes.set(blockNumber, block.timestamp);
    }
    return blockTimes.get(blockNumber)!;
  }

  async function queryEvents(filter: ReturnType<Contract["filters"][string]>): Promise<EventLog[]> {
    const latest = await provider.getBlockNumber();
    const out: EventLog[] = [];
    for (let from = DEPLOY_BLOCK; from <= latest; from += LOG_CHUNK) {
      const to = Math.min(from + LOG_CHUNK - 1, latest);
      const logs = await contract.queryFilter(filter, from, to);
      out.push(...logs.filter((l: Log): l is EventLog => l instanceof EventLog));
    }
    return out;
  }

  const registry: Registry = {
    demo: false,

    config() {
      configCache ??= (async () => {
        const [deposit, minBid, commitDuration, revealDuration, settlementDuration, treasury] = await Promise.all([
          contract.deposit(),
          contract.minBid(),
          contract.commitDuration(),
          contract.revealDuration(),
          contract.settlementDuration(),
          contract.treasury(),
        ]);
        return {
          deposit,
          minBid,
          commitDuration: Number(commitDuration),
          revealDuration: Number(revealDuration),
          settlementDuration: Number(settlementDuration),
          treasury,
        };
      })().catch((err) => {
        configCache = null;
        throw err;
      });
      return configCache;
    },

    blockNumber: () => provider.getBlockNumber(),

    async lookup(domain: string): Promise<DomainLookup> {
      const hash = nameHash(domain);
      const [owner, activeId] = await Promise.all([contract.resolve(domain), contract.activeAuctionOf(hash)]);
      const auction = activeId === 0n ? null : await registry.auction(activeId);
      return { domain, nameHash: hash, owner: owner === ZeroAddress ? null : owner, auction };
    },

    async auction(id: bigint) {
      return toAuction(await contract.getAuction(id));
    },

    async bid(id: bigint, bidder: string): Promise<BidInfo> {
      const b = await contract.getBid(id, bidder);
      return {
        commitment: b.commitment,
        commitIndex: Number(b.commitIndex),
        revealed: b.revealed,
        eligible: b.eligible,
        reason: Number(b.reason) as Ineligibility,
        withdrawn: b.withdrawn,
        amount: b.amount,
      };
    },

    async rank(id: bigint, bidder: string): Promise<RankInfo | null> {
      try {
        const [rank, windowStart, windowEnd] = await contract.rankOf(id, bidder);
        return { rank: Number(rank), windowStart: Number(windowStart), windowEnd: Number(windowEnd) };
      } catch {
        return null; // not eligible
      }
    },

    async currentOfferee(id: bigint) {
      const who: string = await contract.currentOfferee(id);
      return who === ZeroAddress ? null : who;
    },

    canWithdraw: (id: bigint, bidder: string) => contract.canWithdraw(id, bidder),

    async resolve(domain: string) {
      const address: string = await contract.resolve(domain);
      return address === ZeroAddress ? null : address;
    },

    async reverseResolve(address: string) {
      const domain: string = await contract.reverseResolve(address);
      return domain || null;
    },

    async ownedNames(address: string): Promise<OwnedName[]> {
      const [names, primary, registrations] = await Promise.all([
        contract.namesOf(address) as Promise<string[]>,
        registry.reverseResolve(address),
        queryEvents(contract.filters.NameRegistered(null, null, address)),
      ]);
      const byDomain = new Map(registrations.map((e) => [e.args.domain as string, e]));
      return Promise.all(
        names.map(async (domain) => {
          const event = byDomain.get(domain);
          return {
            domain,
            isPrimary: domain === primary,
            resolvedAddress: address, // resolution is fixed to the owner (SPEC §2.7)
            price: event ? (event.args.price as bigint) : null,
            registeredAt: event ? await blockTime(event.blockNumber) : null,
          };
        }),
      );
    },

    async myAuctions(address: string): Promise<MyAuction[]> {
      const commits = await queryEvents(contract.filters.BidCommitted(null, address));
      const ids = [...new Set(commits.map((e) => e.args.auctionId as bigint))].sort((a, b) => (b > a ? 1 : -1));
      return Promise.all(
        ids.map(async (id) => {
          const [auction, bid] = await Promise.all([registry.auction(id), registry.bid(id, address)]);
          return { auction, bid, domain: auction.domain || knownDomain(auction.nameHash) };
        }),
      );
    },

    async history(address: string): Promise<HistoryItem[]> {
      const cfg = await registry.config();
      const f = contract.filters;
      const [started, committed, revealed, registered, settled, withdrawn, primary] = await Promise.all([
        queryEvents(f.AuctionStarted(null, null, address)),
        queryEvents(f.BidCommitted(null, address)),
        queryEvents(f.BidRevealed(null, address)),
        queryEvents(f.NameRegistered(null, null, address)),
        queryEvents(f.AuctionSettled(null, address)),
        queryEvents(f.DepositWithdrawn(null, address)),
        queryEvents(f.PrimaryNameSet(address)),
      ]);

      const auctionDomain = new Map<string, string>();
      const labelFor = async (id: bigint): Promise<string> => {
        const key = id.toString();
        if (!auctionDomain.has(key)) {
          const a = await registry.auction(id);
          auctionDomain.set(key, a.domain || knownDomain(a.nameHash) || `auction #${key}`);
        }
        const d = auctionDomain.get(key)!;
        return d.startsWith("auction #") ? d : fqdn(d);
      };

      const items: Array<Omit<HistoryItem, "timestamp">> = [];
      for (const e of started) {
        const d = knownDomain(e.args.nameHash);
        items.push({ key: `${e.transactionHash}-start`, label: `Auction started (${d ? fqdn(d) : `auction #${e.args.auctionId}`})`, txHash: e.transactionHash, blockNumber: e.blockNumber });
      }
      for (const e of committed)
        items.push({ key: `${e.transactionHash}-commit`, label: `Bid commitment (${await labelFor(e.args.auctionId)})`, detail: "Deposit paid", txHash: e.transactionHash, blockNumber: e.blockNumber, amountWei: -cfg.deposit });
      for (const e of revealed) {
        const reason = Number(e.args.reason) as Ineligibility;
        items.push({ key: `${e.transactionHash}-reveal`, label: `Bid revealed (${await labelFor(e.args.auctionId)})`, detail: `${formatEth(e.args.bid)} · ${e.args.eligible ? "eligible" : INELIGIBILITY_LABEL[reason]}`, txHash: e.transactionHash, blockNumber: e.blockNumber });
      }
      const registeredByTx = new Map(registered.map((e) => [e.transactionHash, e.args.domain as string]));
      for (const e of settled) {
        const domain = registeredByTx.get(e.transactionHash);
        items.push({ key: `${e.transactionHash}-settle`, label: `Paid winning bid · registered ${domain ? fqdn(domain) : await labelFor(e.args.auctionId)}`, detail: `Final price ${formatEth(e.args.price)}`, txHash: e.transactionHash, blockNumber: e.blockNumber, amountWei: -(e.args.price - cfg.deposit) });
      }
      for (const e of withdrawn)
        items.push({ key: `${e.transactionHash}-refund`, label: `Deposit refunded (${await labelFor(e.args.auctionId)})`, txHash: e.transactionHash, blockNumber: e.blockNumber, amountWei: e.args.amount });
      for (const e of primary)
        items.push({ key: `${e.transactionHash}-primary`, label: `Primary name set to ${fqdn(e.args.domain)}`, txHash: e.transactionHash, blockNumber: e.blockNumber });

      const withTimes = await Promise.all(items.map(async (i) => ({ ...i, timestamp: await blockTime(i.blockNumber) })));
      return withTimes.sort((a, b) => b.blockNumber - a.blockNumber);
    },
  };
  return registry;
}
