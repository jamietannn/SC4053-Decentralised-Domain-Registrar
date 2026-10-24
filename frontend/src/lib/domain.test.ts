import { describe, expect, it } from "vitest";
import { ZeroHash } from "ethers";
import { commitmentOf, hasCommitment, isSalt, nameHash, normalise, parseEthAmount, randomSalt, validateDomain } from "./domain";
import { decodeError } from "./errors";
import { countdown, fmtEth } from "./format";
import { rateIsFresh } from "./sgd";

describe("domain normalisation and validation", () => {
  it("lowercases, trims and strips .ntu", () => {
    expect(normalise("  Alice.NTU ")).toBe("alice");
    expect(normalise("bob")).toBe("bob");
  });
  it("accepts 3–32 chars of a–z0–9", () => {
    expect(validateDomain("abc")).toBeNull();
    expect(validateDomain("a".repeat(32))).toBeNull();
    expect(validateDomain("abc123")).toBeNull();
  });
  it("rejects bad names", () => {
    for (const bad of ["ab", "a".repeat(33), "al-ice", "Alice", "ali ce", "ünï", ""]) expect(validateDomain(bad)).not.toBeNull();
  });
});

describe("commitment", () => {
  const salt = "0x" + "00".repeat(31) + "01";
  it("is deterministic and sensitive to every input", () => {
    const c = commitmentOf("alice", 10n ** 16n, salt);
    expect(c).toMatch(/^0x[0-9a-f]{64}$/);
    expect(commitmentOf("alice", 10n ** 16n, salt)).toBe(c);
    expect(commitmentOf("alicf", 10n ** 16n, salt)).not.toBe(c);
    expect(commitmentOf("alice", 10n ** 16n + 1n, salt)).not.toBe(c);
    expect(commitmentOf("alice", 10n ** 16n, "0x" + "00".repeat(31) + "02")).not.toBe(c);
  });
  it("regression pin for abi.encode(string,uint256,bytes32); contract equivalence is proven in test/frontend-commitment.test.ts", () => {
    expect(commitmentOf("alice", 10n ** 16n, salt)).toBe("0xc7f5f20ca29d0b302cd10af2b48c7a0b7e2efb0570a27f0bfa742baaa58cae5a");
  });
  it("generates 32-byte salts that are not repeated", () => {
    const a = randomSalt(), b = randomSalt();
    expect(isSalt(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(isSalt("0x1234")).toBe(false);
  });
  it("hashes names with keccak256", () => {
    expect(nameHash("alice")).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("hasCommitment", () => {
  it("is false for the empty bytes32 (an address that never committed) and true otherwise", () => {
    expect(hasCommitment(ZeroHash)).toBe(false);
    expect(hasCommitment(commitmentOf("alice", 1n, "0x" + "00".repeat(31) + "01"))).toBe(true);
  });
});

describe("amount parsing and formatting", () => {
  it("parses decimals", () => {
    expect(parseEthAmount("0.5")).toBe(5n * 10n ** 17n);
    expect(parseEthAmount("0.50 ETH")).toBe(5n * 10n ** 17n);
    expect(parseEthAmount("1")).toBe(10n ** 18n);
  });
  it("rejects junk and negatives", () => {
    for (const bad of ["", "abc", "-1", "1e3", "0x10", "1.2.3"]) expect(parseEthAmount(bad)).toBeNull();
  });
  it("formats", () => {
    expect(fmtEth(5n * 10n ** 15n)).toBe("0.005");
    expect(countdown(3725)).toBe("01:02:05");
    expect(countdown(-4)).toBe("00:00:00");
  });
});

describe("SGD rate freshness", () => {
  it("treats a missing or >10 minute old rate as unavailable", () => {
    const now = 1_000_000_000;
    expect(rateIsFresh(null, now)).toBe(false);
    expect(rateIsFresh({ sgdPerEth: 3000, fetchedAt: now - 9 * 60_000 }, now)).toBe(true);
    expect(rateIsFresh({ sgdPerEth: 3000, fetchedAt: now - 11 * 60_000 }, now)).toBe(false);
  });
});

describe("error decoding", () => {
  it("recognises wallet rejection as cancelled", () => {
    expect(decodeError({ code: "ACTION_REJECTED" })).toEqual({ cancelled: true, message: "Transaction cancelled." });
  });
  it("maps custom errors to readable messages", () => {
    expect(decodeError({ revert: { name: "CommitmentUsed" } }).message).toMatch(/already used/);
    expect(decodeError({ revert: { name: "NotYourTurn" } }).cancelled).toBe(false);
  });
});
