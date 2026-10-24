import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther } from "ethers";
import { Phase, loadAuction, readContract, readProvider, hasContract, type AuctionInfo } from "../lib/chain";
import { DEMO, DEPLOY_BLOCK } from "../lib/config";
import { demoAuctions, demoHistory, demoNames } from "../lib/demo";
import { ZERO, fmtEth } from "../lib/format";
import { bidCommittedBy, historyFilters, nameRegisteredBy } from "../lib/filters";
import { labelFor } from "../lib/labels";
import { fetchRate, type Rate } from "../lib/sgd";
import { useTx } from "./tx";

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return now;
}

/** Runs `fn` now, on an interval, and whenever a transaction confirms. */
export function usePoll<T>(fn: () => Promise<T>, deps: unknown[], ms = 6000) {
  const { version } = useTx();
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let live = true;
    const load = async () => {
      try { const d = await fnRef.current(); if (live) { setData(d); setError(undefined); } }
      catch (e) { if (live) setError(e); }
      finally { if (live) setLoading(false); }
    };
    load();
    const i = setInterval(load, ms);
    return () => { live = false; clearInterval(i); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, ms, tick, version]);

  return { data, error, loading, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** True when the configured RPC cannot be reached (drives the "Network unavailable" banner). */
export function useNetworkDown() {
  const { data, error } = usePoll(async () => (hasContract && !DEMO ? readProvider.getBlockNumber() : 0), [], 15000);
  return !DEMO && (!hasContract || (error !== undefined && data === undefined));
}

export function useRate() {
  const [rate, setRate] = useState<Rate | null>(null);
  useEffect(() => {
    if (DEMO) { setRate({ sgdPerEth: 3111.36, fetchedAt: Date.now() }); return; }
    let live = true;
    const load = async () => { const r = await fetchRate(); if (live && r) setRate(r); };
    load();
    const i = setInterval(load, 60000);
    return () => { live = false; clearInterval(i); };
  }, []);
  return rate;
}

export interface MyAuction { auction: AuctionInfo; label?: string; canWithdraw: boolean }

/** Auctions the account committed to, found via indexed BidCommitted events. */
export function useMyAuctions(account: string | null) {
  return usePoll<MyAuction[]>(async () => {
    if (DEMO) return demoAuctions();
    if (!account) return [];
    const logs = await readContract.queryFilter(bidCommittedBy(readContract, account), DEPLOY_BLOCK);
    const ids = [...new Set(logs.map((l) => (l as any).args.id as bigint))];
    const out: MyAuction[] = [];
    for (const id of ids) {
      const auction = await loadAuction(id);
      const canWithdraw: boolean = await readContract.canWithdraw(id, account);
      out.push({ auction, label: labelFor(auction.nameHash), canWithdraw });
    }
    return out.sort((a, b) => Number(b.auction.id - a.auction.id));
  }, [account]);
}

export interface MyName { name: string; primary: boolean; resolved: string; price?: bigint; date?: number }

export function useMyNames(account: string | null) {
  return usePoll<MyName[]>(async () => {
    if (DEMO) return demoNames;
    if (!account) return [];
    const names: string[] = await readContract.namesOf(account);
    const primary: string = await readContract.reverseResolve(account);
    const logs = await readContract.queryFilter(nameRegisteredBy(readContract, account), DEPLOY_BLOCK);
    const info = new Map<string, { price: bigint; block: number }>();
    for (const l of logs) info.set((l as any).args.domain, { price: (l as any).args.price, block: l.blockNumber });
    return Promise.all(names.map(async (name) => {
      const i = info.get(name);
      const date = i ? (await readProvider.getBlock(i.block))?.timestamp : undefined;
      return { name, primary: name === primary, resolved: await readContract.resolve(name), price: i?.price, date };
    }));
  }, [account]);
}

export interface HistoryItem { key: string; title: string; amount?: string; status: string; at: number; hash: string }

const EVENT_TITLES: Record<string, (a: any) => { title: string; amount?: string }> = {
  AuctionStarted: (a) => ({ title: `Auction started (#${a.id})` }),
  BidCommitted: (a) => ({ title: `Bid commitment (${labelOfAuction(a.id)})` }),
  BidRevealed: (a) => ({ title: `Bid revealed (${a.domain}.ntu)${a.eligible ? "" : " – ineligible"}`, amount: `${fmtEth(a.bid)} ETH` }),
  NameRegistered: (a) => ({ title: `Name registered (${a.domain}.ntu)`, amount: `${fmtEth(a.price)} ETH` }),
  AuctionSettled: (a) => ({ title: `Auction settled (#${a.id})`, amount: `${fmtEth(a.price)} ETH` }),
  DepositWithdrawn: (a) => ({ title: `Deposit withdrawn (#${a.id})`, amount: `${fmtEth(a.amount)} ETH` }),
  PrimaryNameSet: (a) => ({ title: `Primary name set (${a.domain}.ntu)` }),
};
const labelOfAuction = (id: bigint) => `auction #${id}`;

/** Contract events involving the account (direct ETH sends are not listed, per SPEC.md §7). */
export function useHistory(account: string | null) {
  const { txs } = useTx();
  const chain = usePoll<HistoryItem[]>(async () => {
    if (DEMO) return demoHistory as HistoryItem[];
    if (!account) return [];
    const queries = historyFilters(readContract, account);
    const logs = (await Promise.all(queries.map((q) => readContract.queryFilter(q, DEPLOY_BLOCK)))).flat();
    const cache = new Map<number, number>();
    const items: HistoryItem[] = [];
    for (const l of logs as any[]) {
      if (!cache.has(l.blockNumber)) cache.set(l.blockNumber, (await readProvider.getBlock(l.blockNumber))!.timestamp);
      const t = EVENT_TITLES[l.fragment.name]?.(l.args);
      if (!t) continue;
      items.push({ key: `${l.transactionHash}-${l.index}`, ...t, status: "confirmed", at: cache.get(l.blockNumber)! * 1000, hash: l.transactionHash });
    }
    return items;
  }, [account]);

  const pending: HistoryItem[] = txs
    .filter((t) => t.status === "pending" || t.status === "failed")
    .map((t) => ({ key: `s-${t.key}`, title: t.label, amount: t.amount, status: t.status, at: t.at, hash: t.hash ?? "" }));
  const confirmedHashes = new Set((chain.data ?? []).map((i) => i.hash));
  const all = [...pending.filter((p) => !confirmedHashes.has(p.hash)), ...(chain.data ?? [])].sort((a, b) => b.at - a.at);
  return { ...chain, data: all };
}

export const phaseEnd = (a: AuctionInfo, settlementSecs: number): number =>
  a.phase === Phase.Commit ? a.commitDeadline : a.phase === Phase.Reveal ? a.revealDeadline : a.revealDeadline + a.eligibleCount * settlementSecs;

export { formatEther, ZERO };
