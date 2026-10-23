import { useTx, TxStatus } from "../state/tx";
import { TxLink } from "./ui";

const STATUS_TEXT: Record<TxStatus, string> = {
  wallet: "Waiting for wallet confirmation…",
  pending: "Pending — waiting for the transaction to be mined…",
  confirmed: "Confirmed",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Bottom-right stack showing this session's recent transactions and their live status. */
export function TxTray() {
  const { transactions, dismiss } = useTx();
  const visible = transactions.slice(0, 3);
  if (visible.length === 0) return null;
  return (
    <div className="tx-tray" aria-live="polite">
      {visible.map((t) => (
        <div key={t.id} className={`tx-item tx-${t.status}`}>
          <div className="tx-item-head">
            <strong>{t.label}</strong>
            {t.status !== "wallet" && t.status !== "pending" && (
              <button className="tx-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                ×
              </button>
            )}
          </div>
          <div>{STATUS_TEXT[t.status]}</div>
          {t.message && <div className="tx-msg">{t.message}</div>}
          {t.hash && (
            <div>
              Tx: <TxLink hash={t.hash} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
