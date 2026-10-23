import { describe, expect, it } from "vitest";
import { checkAddress } from "./address";

const CHECKSUMMED = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("address lookup input (AC63)", () => {
  it("accepts lower-case, upper-case and checksummed addresses and returns the checksummed form", () => {
    for (const input of [CHECKSUMMED, CHECKSUMMED.toLowerCase(), "0x" + CHECKSUMMED.slice(2).toUpperCase(), `  ${CHECKSUMMED} `])
      expect(checkAddress(input)).toEqual({ ok: true, address: CHECKSUMMED });
  });

  it("rejects a mixed-case address with a bad checksum", () => {
    const bad = CHECKSUMMED.replace("C51812", "c51812");
    const r = checkAddress(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/checksum/);
  });

  it("rejects wrong length, missing 0x, non-hex and empty input", () => {
    for (const bad of ["", "0x1234", CHECKSUMMED + "0", CHECKSUMMED.slice(2), "0x" + "g".repeat(40), "alice.ntu"])
      expect(checkAddress(bad).ok).toBe(false);
  });
});
