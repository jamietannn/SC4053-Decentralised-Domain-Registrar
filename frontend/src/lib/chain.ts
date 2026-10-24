import { Contract, JsonRpcProvider, type ContractRunner } from "ethers";
import abi from "./abi.json";
import { CHAIN_ID, CONTRACT_ADDRESS, RPC_URL } from "./config";

// Reads always go through the configured RPC so search works without a wallet.
export const readProvider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
export const hasContract = CONTRACT_ADDRESS !== "";
export const readContract = new Contract(CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000001", abi, readProvider);
export const withSigner = (runner: ContractRunner) => readContract.connect(runner) as Contract;

export enum Phase { None, Commit, Reveal, Settlement, Settled, Closed }
export const PHASE_LABEL: Record<number, string> = {
  [Phase.None]: "None", [Phase.Commit]: "Commit phase", [Phase.Reveal]: "Reveal phase",
  [Phase.Settlement]: "Settlement", [Phase.Settled]: "Settled", [Phase.Closed]: "Closed",
};
export const REASON_LABEL = ["", "invalid name format", "wrong domain for this auction", "bid below the minimum"];

export interface AuctionInfo {
  id: bigint; nameHash: string; starter: string; commitDeadline: number; revealDeadline: number;
  commitCount: number; revealCount: number; eligibleCount: number; settled: boolean; finalised: boolean;
  winner: string; winningBid: bigint; phase: Phase;
}

export async function loadAuction(id: bigint): Promise<AuctionInfo> {
  const a = await readContract.getAuction(id);
  return {
    id, nameHash: a.nameHash, starter: a.starter, commitDeadline: Number(a.commitDeadline), revealDeadline: Number(a.revealDeadline),
    commitCount: Number(a.commitCount), revealCount: Number(a.revealCount), eligibleCount: Number(a.eligibleCount),
    settled: a.settled, finalised: a.finalised, winner: a.winner, winningBid: a.winningBid, phase: Number(a.phase) as Phase,
  };
}
