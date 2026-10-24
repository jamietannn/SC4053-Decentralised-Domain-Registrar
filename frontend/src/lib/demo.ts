// Fixed sample data for demo mode (?demo=1). Nothing here is on-chain.
import { Phase, type AuctionInfo } from "./chain";
import { nameHash } from "./domain";

const now = () => Math.floor(Date.now() / 1000);
const ETH = 10n ** 18n;
const ME = "0x71C7656EC7ab88b098defB751B7401B5f6d83F2e";

export const DEMO_ACCOUNT = ME;

export const demoNames = [
  { name: "javier", primary: true, resolved: ME, price: (17n * ETH) / 10n, date: 1785000000 },
  { name: "data", primary: false, resolved: ME, price: (9n * ETH) / 10n, date: 1789600000 },
  { name: "example3", primary: false, resolved: "0xA9d1e08C7793af67e9d92fe308d5697FB81d88c1", price: (22n * ETH) / 10n, date: 1790800000 },
];

function auction(id: number, name: string, phase: Phase, remaining: number): { auction: AuctionInfo; label: string; canWithdraw: boolean } {
  const t = now();
  return {
    label: name,
    canWithdraw: false,
    auction: {
      id: BigInt(id), nameHash: nameHash(name), starter: ME, commitDeadline: t + remaining, revealDeadline: t + remaining + 180,
      commitCount: 3, revealCount: 2, eligibleCount: 2, settled: false, finalised: false,
      winner: "0x0000000000000000000000000000000000000000", winningBid: 0n, phase,
    },
  };
}

export const demoAuctions = () => [
  auction(1, "example1", Phase.Commit, 17 * 3600 + 2200),
  auction(2, "example2", Phase.Reveal, 6 * 3600 + 2200),
  auction(3, "blockchain", Phase.Reveal, 2 * 3600 + 2756),
  auction(4, "example4", Phase.Settlement, 3600 + 1679),
];

export const demoSearch: Record<string, { kind: "available" } | { kind: "auction"; phase: Phase; id: number } | { kind: "registered"; owner: string }> = {
  example: { kind: "available" },
  example1: { kind: "auction", phase: Phase.Commit, id: 1 },
  example2: { kind: "auction", phase: Phase.Reveal, id: 2 },
  example3: { kind: "registered", owner: "0xA9d1e08C7793af67e9d92fe308d5697FB81d88c1" },
  example4: { kind: "auction", phase: Phase.Settlement, id: 4 },
};

export const demoHistory = [
  { key: "a", title: "Bid commitment (example2.ntu)", amount: "0.005 ETH", status: "pending", at: Date.parse("2026-10-20T22:35:00"), hash: "0x8f2a000000000000000000000000000000000000000000000000000000c91d" },
  { key: "b", title: "Name registered (data.ntu)", amount: "0.9 ETH", status: "confirmed", at: Date.parse("2026-09-17T10:00:00"), hash: "0x4b71000000000000000000000000000000000000000000000000000000a820" },
  { key: "c", title: "Bid commitment (example3.ntu)", amount: "0.005 ETH", status: "confirmed", at: Date.parse("2026-10-06T11:23:00"), hash: "0x8f7a000000000000000000000000000000000000000000000000000000c62e" },
];
