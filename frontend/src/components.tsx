import { useState, type ReactNode } from "react";
import { useTx } from "./state/tx";
import { useWallet } from "./state/wallet";
import { DEMO, chainName, CHAIN_ID } from "./lib/config";
import { shortAddr } from "./lib/format";

export const Badge = ({ kind, children }: { kind: string; children: ReactNode }) => <span className={`badge badge-${kind}`}>{children}</span>;

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="link small" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
    }}>{done ? "Copied" : "Copy"}</button>
  );
}

/** Button that is disabled in demo mode, without a usable wallet, or while another tx is pending. */
export function TxButton({ children, onClick, disabled, className = "primary", why }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; className?: string; why?: string;
}) {
  const { canSend, account, wrongChain } = useWallet();
  const { busy } = useTx();
  const reason = DEMO ? "Demo mode: transactions are disabled." : !account ? "Connect your wallet first." : wrongChain ? `Switch to ${chainName(CHAIN_ID)}.` : busy ? "Waiting for the pending transaction." : why;
  const off = disabled || !canSend || busy;
  return <button type="button" className={className} disabled={off} title={off ? reason : undefined} onClick={onClick}>{children}</button>;
}

export function Banners({ networkDown }: { networkDown: boolean }) {
  const w = useWallet();
  return (
    <>
      {DEMO && <div className="banner demo">DEMO DATA – not on-chain. Every transaction button is disabled.</div>}
      {networkDown && <div className="banner error">Network unavailable. Check the RPC connection; actions are disabled.</div>}
      {w.wrongChain && !DEMO && (
        <div className="banner warn">
          Your wallet is on {chainName(w.chainId!)}; this app uses {chainName(CHAIN_ID)}. Transactions are disabled.{" "}
          <button className="link" onClick={w.switchChain}>Switch to {chainName(CHAIN_ID)}</button>
        </div>
      )}
      {w.error && !DEMO && <div className="banner error">{w.error}</div>}
    </>
  );
}

export function TxToast() {
  const { last, dismiss } = useTx();
  if (!last) return null;
  const text = { pending: "Pending… confirm in your wallet / waiting to be mined", confirmed: "Confirmed", failed: last.message ?? "Failed", cancelled: "Cancelled" }[last.status];
  return (
    <div className={`toast toast-${last.status}`} role="status">
      <div><strong>{last.label}</strong></div>
      <div>{text}</div>
      {last.hash && <div className="mono small">Tx: {last.hash.slice(0, 10)}…{last.hash.slice(-6)}</div>}
      {last.status !== "pending" && <button className="link small" onClick={dismiss}>Dismiss</button>}
    </div>
  );
}

export function WalletChip() {
  const w = useWallet();
  if (DEMO) return <div className="chip small">Demo wallet<br /><span className="mono">0x71C7…3F2e</span></div>;
  if (!w.account) return <button className="primary small-btn" onClick={w.connect}>Connect MetaMask</button>;
  return <div className="chip small">{shortAddr(w.account)}<br /><span className="muted">{w.chainId ? chainName(w.chainId) : ""}</span></div>;
}
