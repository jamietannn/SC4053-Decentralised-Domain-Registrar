import { describe, expect, it } from "vitest";
import { phaseDeadline, settlementWindow } from "./phase";
import { AuctionInfo, Phase } from "./types";

const auction = (phase: Phase): AuctionInfo => ({
  id: 1n,
  nameHash: "0x",
  starter: "0x",
  commitDeadline: 1000,
  revealDeadline: 1180,
  commitCount: 2,
  revealCount: 2,
  eligibleCount: 2,
  ineligibleCount: 0,
  settled: false,
  finalised: false,
  winner: "0x",
  winningBid: 0n,
  domain: "",
  phase,
});

describe("phase deadlines (half-open windows, SPEC §5)", () => {
  it("uses the commit and reveal deadlines", () => {
    expect(phaseDeadline(auction(Phase.Commit), 180, 900)).toBe(1000);
    expect(phaseDeadline(auction(Phase.Reveal), 180, 1100)).toBe(1180);
    expect(phaseDeadline(auction(Phase.Closed), 180, 2000)).toBeNull();
  });

  it("computes the settlement window index with half-open boundaries", () => {
    expect(settlementWindow(1180, 180, 1180)).toBe(0);
    expect(settlementWindow(1180, 180, 1359)).toBe(0);
    expect(settlementWindow(1180, 180, 1360)).toBe(1);
    expect(phaseDeadline(auction(Phase.Settlement), 180, 1180)).toBe(1360);
    expect(phaseDeadline(auction(Phase.Settlement), 180, 1360)).toBe(1540);
  });
});
