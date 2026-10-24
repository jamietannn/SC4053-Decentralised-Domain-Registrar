import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { TransactionResponse } from "ethers";
import { decodeError } from "../lib/errors";

export interface TrackedTx {
  key: number;
  label: string;
  hash?: string;
  amount?: string;
  status: "pending" | "confirmed" | "failed" | "cancelled";
  message?: string;
  at: number;
}

interface TxState {
  txs: TrackedTx[];
  busy: boolean;
  last: TrackedTx | null;
  /** Runs a transaction. Resolves true only after a mined receipt with status 1. */
  run: (label: string, send: () => Promise<TransactionResponse>, opts?: { amount?: string }) => Promise<boolean>;
  dismiss: () => void;
  /** bumps whenever a transaction confirms, so views can reload */
  version: number;
}

const Ctx = createContext<TxState>(null as unknown as TxState);
export const useTx = () => useContext(Ctx);

let counter = 0;

export function TxProvider({ children }: { children: ReactNode }) {
  const [txs, setTxs] = useState<TrackedTx[]>([]);
  const [last, setLast] = useState<TrackedTx | null>(null);
  const [version, setVersion] = useState(0);

  const patch = (key: number, p: Partial<TrackedTx>) => {
    setTxs((all) => all.map((t) => (t.key === key ? { ...t, ...p } : t)));
    setLast((l) => (l && l.key === key ? { ...l, ...p } : l));
  };

  const run: TxState["run"] = useCallback(async (label, send, opts) => {
    const key = ++counter;
    const t: TrackedTx = { key, label, amount: opts?.amount, status: "pending", at: Date.now() };
    setTxs((all) => [t, ...all]);
    setLast(t);
    try {
      const resp = await send();
      patch(key, { hash: resp.hash });
      const receipt = await resp.wait(1);
      if (!receipt || receipt.status !== 1) throw new Error("Transaction reverted.");
      patch(key, { status: "confirmed" });
      setVersion((v) => v + 1);
      return true;
    } catch (e) {
      const d = decodeError(e);
      patch(key, { status: d.cancelled ? "cancelled" : "failed", message: d.message });
      return false;
    }
  }, []);

  const busy = txs.some((t) => t.status === "pending");
  return <Ctx.Provider value={{ txs, busy, last, run, dismiss: () => setLast(null), version }}>{children}</Ctx.Provider>;
}
