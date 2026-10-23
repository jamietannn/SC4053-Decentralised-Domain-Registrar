import { Interface, TransactionReceipt } from "ethers";
import abi from "../generated/NtuNames.abi.json";
import { AuctionInfo, Phase } from "./types";

/** Settlement window index k: offer k is payable during [revealDeadline + k·S, revealDeadline + (k+1)·S). */
export function settlementWindow(revealDeadline: number, settlementDuration: number, now: number): number {
  return Math.max(0, Math.floor((now - revealDeadline) / settlementDuration));
}

/** When the auction's current phase (or current settlement window) ends, for countdowns. */
export function phaseDeadline(a: AuctionInfo, settlementDuration: number, now: number): number | null {
  switch (a.phase) {
    case Phase.Commit:
      return a.commitDeadline;
    case Phase.Reveal:
      return a.revealDeadline;
    case Phase.Settlement:
      return a.revealDeadline + (settlementWindow(a.revealDeadline, settlementDuration, now) + 1) * settlementDuration;
    default:
      return null;
  }
}

const iface = new Interface(abi);

export function auctionIdFromReceipt(receipt: TransactionReceipt): bigint | null {
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "AuctionStarted") return parsed.args.auctionId as bigint;
    } catch {
      /* not our event */
    }
  }
  return null;
}
