// Display-only ETH→SGD estimate from CoinGecko. Anything older than 10 minutes is treated as unavailable.
const URL = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=sgd";
export const MAX_RATE_AGE_MS = 10 * 60 * 1000;

export interface Rate { sgdPerEth: number; fetchedAt: number }

export async function fetchRate(): Promise<Rate | null> {
  try {
    const r = await fetch(URL);
    if (!r.ok) return null;
    const v = (await r.json())?.ethereum?.sgd;
    return typeof v === "number" ? { sgdPerEth: v, fetchedAt: Date.now() } : null;
  } catch {
    return null;
  }
}

export const rateIsFresh = (r: Rate | null, now = Date.now()) => !!r && now - r.fetchedAt <= MAX_RATE_AGE_MS;
