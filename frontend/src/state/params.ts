import { readContract } from "../lib/chain";
import { DEMO } from "../lib/config";
import { usePoll } from "./hooks";
import { useWallet } from "./wallet";
import { DEMO_ACCOUNT } from "../lib/demo";

export interface Params { deposit: bigint; minBid: bigint; settlementDuration: number }
const DEMO_PARAMS: Params = { deposit: 5n * 10n ** 15n, minBid: 5n * 10n ** 15n, settlementDuration: 180 };

/** Immutable contract parameters (deposit, minimum bid, settlement window). */
export function useParams(): Params | undefined {
  const { data } = usePoll<Params>(async () => {
    if (DEMO) return DEMO_PARAMS;
    const [deposit, minBid, s] = await Promise.all([readContract.deposit(), readContract.minBid(), readContract.settlementDuration()]);
    return { deposit, minBid, settlementDuration: Number(s) };
  }, [], 60000);
  return data;
}

/** The address the UI acts for: the wallet account, or a fixed sample address in demo mode. */
export function useAccount(): string | null {
  const { account } = useWallet();
  return DEMO ? DEMO_ACCOUNT : account;
}
