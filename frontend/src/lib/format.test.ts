import { describe, expect, it } from "vitest";
import { formatCountdown, formatEth, parseEthInput } from "./format";

describe("formatting helpers", () => {
  it("parses ETH input strictly", () => {
    expect(parseEthInput("0.5")).toBe(500_000_000_000_000_000n);
    expect(parseEthInput(".5")).toBe(500_000_000_000_000_000n);
    expect(parseEthInput("2")).toBe(2_000_000_000_000_000_000n);
    for (const bad of ["", "abc", "-1", "1e3", "0.1234567890123456789"]) expect(parseEthInput(bad)).toBeNull();
  });

  it("formats ETH and countdowns", () => {
    expect(formatEth(5_000_000_000_000_000n)).toBe("0.005 ETH");
    expect(formatEth(2_000_000_000_000_000_000n)).toBe("2 ETH");
    expect(formatCountdown(3725)).toBe("01:02:05");
    expect(formatCountdown(-5)).toBe("00:00:00");
  });
});
