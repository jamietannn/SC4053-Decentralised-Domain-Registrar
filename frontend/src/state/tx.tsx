import { Contract, JsonRpcSigner, TransactionReceipt, TransactionResponse } from "ethers";
import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import abi from "../generated/NtuNames.abi.json";
import { CONTRACT_ADDRESS } from "../config";
import { describeError } from "../lib/errors";
import { useWallet } from "./wallet";

export type TxStatus = "wallet" | "pending" | "confirmed" | "failed" | "cancelled";

export type SessionTx = {
  id: number;
  label: string;
  status: TxStatus;
  hash?: string;
  message?: string;
  startedAt: number;
};

export type TxResult = { receipt: TransactionReceipt; hash: string; timestamp: number };

type TxState = {
  /** This session's transactions, newest first (shown in History and the status tray). */
  transactions: SessionTx[];
  /** Sign, send and wait for a transaction; resolves to null if it was cancelled or failed. */
  run(
    label: string,
    send: (registrar: Contract, signer: JsonRpcSigner) => Promise<TransactionResponse>,
  ): Promise<TxResult | null>;
  dismiss(id: number): void;
};

const TxContext = createContext<TxState | null>(null);
let nextId = 1;

export function TxProvider({ children }: { children: ReactNode }) {
  const { getSigner, canTransact } = useWallet();
  const [transactions, setTransactions] = useState<SessionTx[]>([]);

  const update = (id: number, patch: Partial<SessionTx>) =>
    setTransactions((txs) => txs.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const run = useCallback<TxState["run"]>(
    async (label, send) => {
      const id = nextId++;
      setTransactions((txs) => [{ id, label, status: "wallet", startedAt: Math.floor(Date.now() / 1000) }, ...txs]);
      try {
        if (!canTransact) throw new Error("Connect your wallet on the correct network first.");
        const signer = await getSigner();
        const registrar = new Contract(CONTRACT_ADDRESS, abi, signer);
        const response = await send(registrar, signer);
        update(id, { status: "pending", hash: response.hash });
        const receipt = await response.wait(1);
        if (!receipt || receipt.status !== 1) {
          update(id, { status: "failed", message: "The transaction was reverted." });
          return null;
        }
        const block = await receipt.getBlock();
        update(id, { status: "confirmed" });
        return { receipt, hash: response.hash, timestamp: block.timestamp };
      } catch (err) {
        const { cancelled, message } = describeError(err);
        update(id, { status: cancelled ? "cancelled" : "failed", message });
        return null;
      }
    },
    [canTransact, getSigner],
  );

  const dismiss = useCallback((id: number) => setTransactions((txs) => txs.filter((t) => t.id !== id)), []);

  return <TxContext.Provider value={{ transactions, run, dismiss }}>{children}</TxContext.Provider>;
}

export function useTx(): TxState {
  const ctx = useContext(TxContext);
  if (!ctx) throw new Error("useTx must be used inside TxProvider");
  return ctx;
}
