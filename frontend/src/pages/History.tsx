import { useHistory } from "../state/hooks";
import { useAccount } from "../state/params";
import { fmtDate } from "../lib/format";

export default function History() {
  const acct = useAccount();
  const h = useHistory(acct);
  return (
    <>
      <h1>Transaction history</h1>
      <p className="sub">Contract events involving your address, plus this session's pending transactions. Direct ETH transfers are not listed.</p>
      {!acct && <div className="muted">Connect a wallet to see your history.</div>}
      {h.error !== undefined && <div className="err">Could not load your history from the network.</div>}
      {h.data?.length === 0 && acct && <div className="muted">No activity yet.</div>}
      <div style={{ maxWidth: 760 }}>
        {h.data?.map((i) => (
          <div className="card" key={i.key} style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <strong>{i.title}</strong>
              <div className="muted small">{fmtDate(i.at / 1000)}</div>
              {i.hash && <div className="muted small mono">Tx: {i.hash.slice(0, 8)}…{i.hash.slice(-4)}</div>}
            </div>
            <div style={{ textAlign: "right" }}>
              <strong>{i.amount ?? ""}</strong>
              <div><span className={`tag tag-${i.status}`}>{i.status[0].toUpperCase() + i.status.slice(1)}</span></div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
