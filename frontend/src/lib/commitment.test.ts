import { describe, expect, it } from "vitest";
import vectorsFile from "../../../shared/commitment-vectors.json";
import { computeCommitment, generateSalt, parseSalt } from "./commitment";
import { nameHash } from "./domain";

describe("commitment encoding (AC51)", () => {
  it.each(vectorsFile.vectors)("matches the shared vector for $domain", (v) => {
    expect(computeCommitment(v.domain, BigInt(v.bidWei), v.salt)).toBe(v.commitment);
    expect(nameHash(v.domain)).toBe(v.nameHash);
  });

  it("changes when any input changes", () => {
    const [v] = vectorsFile.vectors;
    const base = computeCommitment(v.domain, BigInt(v.bidWei), v.salt);
    expect(computeCommitment(v.domain + "x", BigInt(v.bidWei), v.salt)).not.toBe(base);
    expect(computeCommitment(v.domain, BigInt(v.bidWei) + 1n, v.salt)).not.toBe(base);
    expect(computeCommitment(v.domain, BigInt(v.bidWei), "0x" + "22".repeat(32))).not.toBe(base);
  });
});

describe("salts", () => {
  it("generates distinct 32-byte hex salts", () => {
    const a = generateSalt();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(generateSalt()).not.toBe(a);
  });

  it("parses salts with or without 0x and rejects malformed input", () => {
    const hex = "AB".repeat(32);
    expect(parseSalt(hex)).toBe("0x" + "ab".repeat(32));
    expect(parseSalt(`  0x${hex} `)).toBe("0x" + "ab".repeat(32));
    expect(parseSalt("0x1234")).toBeNull();
    expect(parseSalt("zz".repeat(32))).toBeNull();
    expect(parseSalt("")).toBeNull();
  });
});
