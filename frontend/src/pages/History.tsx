import { Badge, Card, Loading, Notice, TxLink } from "../components/ui";
import { formatDateTime, formatEth } from "../lib/format";
import { useAsync } from "../state/hooks";
import { useRegistry } from "../state/registry";
import { TxStatus, useTx } from "../state/tx";
import { useWallet } from "../state/wallet";

const STATUS_BADGE: Record<TxStatus, { tone: string; text: string }> = {
  wallet: { tone: "amber", text: "Awaiting wallet" },
  pending: { tone: "amber", text: "Pending" },
  confirmed: { tone: "green", text: "Confirmed" },
  failed: { tone: "red", text: "Failed" },
  cancelled: { tone: "neutral", text: "Cancelled" },
};

export function History() {
  const { account } = useWallet();
  const { registry } = useRegistry();
  const { transactions } = useTx();
  const events = useAsync(() => (account ? registry.history(account) : Promise.resolve([])), [registry, account], 20_000);

  if (!account)
    return (
      <div className="stack">
        <h1>Transaction history</h1>
        <Notice>Connect your wallet to see your registrar activity.</Notice>
      </div>
    );

  return (
    <div className="stack">
      <h1>Transaction history</h1>

      {transactions.length > 0 && (
        <Card title="This session">
          <ul className="history-list">
            {transactions.map((t) => (
              <li key={t.id} className="history-row">
                <div>
                  <strong>{t.label}</strong>
                  <div className="muted">
                    {formatDateTime(t.startedAt)}
                    {t.hash && (
                      <>
                        {" "}
                        · Tx: <TxLink hash={t.hash} />
                      </>
                    )}
                  </div>
                  {t.message && <div className="muted">{t.message}</div>}
                </div>
                <Badge tone={STATUS_BADGE[t.status].tone}>{STATUS_BADGE[t.status].text}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="On-chain registrar activity">
        <p className="hint">Events from the NtuNames contract involving your address. Direct ETH transfers are not listed here.</p>
        {events.error != null && !events.data && <Notice tone="error">Couldn't load your history. Is the network reachable?</Notice>}
        {!events.data ? (
          events.error == null && <Loading />
        ) : events.data.length === 0 ? (
          <p className="muted">No registrar activity yet.</p>
        ) : (
          <ul className="history-list">
            {events.data.map((item) => (
              <li key={item.key} className="history-row">
                <div>
                  <strong>{item.label}</strong>
                  <div className="muted">
                    {item.timestamp ? formatDateTime(item.timestamp) : `Block ${item.blockNumber}`} · Tx: <TxLink hash={item.txHash} />
                  </div>
                  {item.detail && <div className="muted">{item.detail}</div>}
                </div>
                <div className="history-right">
                  {item.amountWei !== undefined && (
                    <span className={item.amountWei < 0n ? "amount-out" : "amount-in"}>
                      {item.amountWei < 0n ? "− " : "+ "}
                      {formatEth(item.amountWei < 0n ? -item.amountWei : item.amountWei)}
                    </span>
                  )}
                  <Badge tone="green">Confirmed</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
