import { formatEther } from "ethers";

/** Indicative ETH→SGD rate (SPEC §7): CoinGecko, shown only if at most 10 minutes old. */
export const SGD_MAX_AGE_SECONDS = 600;
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=sgd&include_last_updated_at=true";

export type SgdRate = { sgdPerEth: number; updatedAt: number };

export function isRateFresh(rate: SgdRate | null, nowSeconds: number): rate is SgdRate {
  if (!rate || !Number.isFinite(rate.sgdPerEth) || rate.sgdPerEth <= 0) return false;
  const age = nowSeconds - rate.updatedAt;
  return age <= SGD_MAX_AGE_SECONDS && age >= -60;
}

export async function fetchSgdRate(fetchFn: typeof fetch = fetch): Promise<SgdRate> {
  const res = await fetchFn(COINGECKO_URL);
  if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
  const body = await res.json();
  const sgd = body?.ethereum?.sgd;
  const updatedAt = body?.ethereum?.last_updated_at;
  if (typeof sgd !== "number" || typeof updatedAt !== "number") throw new Error("Unexpected CoinGecko response");
  return { sgdPerEth: sgd, updatedAt };
}

/** "≈ 1,555.68 SGD" or null when there is no fresh rate. */
export function sgdEstimate(rate: SgdRate | null, wei: bigint, nowSeconds: number): string | null {
  if (!isRateFresh(rate, nowSeconds)) return null;
  const sgd = Number(formatEther(wei)) * rate.sgdPerEth;
  return `≈ ${sgd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SGD`;
}
