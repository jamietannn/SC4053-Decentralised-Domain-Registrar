import { createContext, ReactNode, useContext } from "react";
import { fetchSgdRate, SgdRate } from "../lib/sgd";
import { useAsync } from "./hooks";

/** Refresh interval for the shared CoinGecko rate (SPEC §7). Freshness is still judged by the rate's own timestamp. */
const RATE_POLL_MS = 60_000;

const SgdRateContext = createContext<SgdRate | null>(null);

/** One app-wide ETH→SGD rate, so every ETH input reuses the same CoinGecko fetch. Display-only. */
export function SgdRateProvider({ children }: { children: ReactNode }) {
  // useAsync keeps the last good value if a refresh fails; isRateFresh then marks it unavailable once it is too old.
  const rate = useAsync(() => fetchSgdRate(), [], RATE_POLL_MS);
  return <SgdRateContext.Provider value={rate.data ?? null}>{children}</SgdRateContext.Provider>;
}

export function useSgdRate(): SgdRate | null {
  return useContext(SgdRateContext);
}
