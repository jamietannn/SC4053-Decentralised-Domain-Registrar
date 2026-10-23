import { describe, expect, it } from "vitest";
import { fetchSgdRate, isRateFresh, SGD_MAX_AGE_SECONDS, sgdEstimate, sgdHint } from "./sgd";

const NOW = 1_800_000_000;

describe("SGD estimate (AC55)", () => {
  it("shows an estimate only for a rate at most 10 minutes old", () => {
    expect(isRateFresh({ sgdPerEth: 4000, updatedAt: NOW - SGD_MAX_AGE_SECONDS }, NOW)).toBe(true);
    expect(isRateFresh({ sgdPerEth: 4000, updatedAt: NOW - SGD_MAX_AGE_SECONDS - 1 }, NOW)).toBe(false);
    expect(isRateFresh(null, NOW)).toBe(false);
    expect(isRateFresh({ sgdPerEth: 0, updatedAt: NOW }, NOW)).toBe(false);
  });

  it("formats the estimate, or returns null when stale", () => {
    const rate = { sgdPerEth: 3111.36, updatedAt: NOW - 30 };
    expect(sgdEstimate(rate, 500_000_000_000_000_000n, NOW)).toMatch(/1,555\.68 SGD$/);
    expect(sgdEstimate({ ...rate, updatedAt: NOW - 3600 }, 1n, NOW)).toBeNull();
  });

  it("gives every ETH input an estimate with the rate time, or 'unavailable' (AC59, AC60)", () => {
    const rate = { sgdPerEth: 4000, updatedAt: NOW - 30 };
    expect(sgdHint(rate, 10n ** 18n, NOW)).toEqual({ unavailable: false, estimate: expect.stringMatching(/4,000\.00 SGD$/), rateTime: NOW - 30 });
    expect(sgdHint({ ...rate, updatedAt: NOW - SGD_MAX_AGE_SECONDS - 1 }, 10n ** 18n, NOW)).toEqual({ unavailable: true });
    expect(sgdHint(null, 10n ** 18n, NOW)).toEqual({ unavailable: true });
    expect(sgdHint(rate, null, NOW)).toBeNull();
  });

  it("rejects a failed or malformed CoinGecko response", async () => {
    const failing = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(fetchSgdRate(failing)).rejects.toThrow();
    const malformed = (async () => new Response(JSON.stringify({ ethereum: {} }))) as unknown as typeof fetch;
    await expect(fetchSgdRate(malformed)).rejects.toThrow();
    const ok = (async () =>
      new Response(JSON.stringify({ ethereum: { sgd: 4000, last_updated_at: NOW } }))) as unknown as typeof fetch;
    await expect(fetchSgdRate(ok)).resolves.toEqual({ sgdPerEth: 4000, updatedAt: NOW });
  });
});
