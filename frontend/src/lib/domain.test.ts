import { describe, expect, it } from "vitest";
import { checkDomain, isValidDomain, normalizeDomainInput } from "./domain";

describe("domain rules (SPEC §2.1)", () => {
  it("normalises case, whitespace and a trailing .ntu", () => {
    expect(normalizeDomainInput("  Alice.NTU ")).toBe("alice");
    expect(normalizeDomainInput("bob")).toBe("bob");
  });

  it("accepts 3-32 characters of a-z0-9", () => {
    for (const ok of ["abc", "ntu2026", "a".repeat(32), "Alice.ntu"]) expect(checkDomain(ok).ok).toBe(true);
  });

  it("rejects bad lengths and characters with a reason", () => {
    for (const bad of ["", "ab", "a".repeat(33), "al-ice", "a_b", "a.b", "café", "a b"]) {
      const result = checkDomain(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("isValidDomain matches the contract rule exactly (no normalisation)", () => {
    expect(isValidDomain("alice")).toBe(true);
    expect(isValidDomain("Alice")).toBe(false);
    expect(isValidDomain("alice.ntu")).toBe(false);
  });
});
