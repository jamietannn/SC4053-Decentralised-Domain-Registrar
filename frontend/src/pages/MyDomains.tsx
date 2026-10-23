import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, Loading, Notice } from "../components/ui";
import { fqdn } from "../lib/domain";
import { formatDateTime, formatEth, shortAddress } from "../lib/format";
import { useAsync } from "../state/hooks";
import { useRegistry } from "../state/registry";
import { useTx } from "../state/tx";
import { useWallet } from "../state/wallet";

export function MyDomains() {
  const { account } = useWallet();
  if (!account)
    return (
      <div className="stack">
        <h1>My domains & primary domain</h1>
        <Notice>Connect your wallet to see the domains you own.</Notice>
      </div>
    );
  return <DomainsTable account={account} />;
}

function DomainsTable({ account }: { account: string }) {
  const { registry } = useRegistry();
  const { canTransact } = useWallet();
  const { run } = useTx();
  const names = useAsync(() => registry.ownedNames(account), [registry, account]);
  const [busy, setBusy] = useState<string | null>(null);

  const setPrimary = async (domain: string) => {
    setBusy(domain);
    const result = await run(`Set primary domain (${fqdn(domain)})`, (r) => r.setPrimaryName(domain));
    setBusy(null);
    if (result) names.reload();
  };

  return (
    <div className="stack">
      <h1>My domains & primary domain</h1>
      <p className="muted">
        Each domain resolves to its owner's address. Your primary domain is what others see when they look up your address.
      </p>
      <Card>
        {names.error != null && !names.data && <Notice tone="error">Couldn't load your domains.</Notice>}
        {!names.data ? (
          <Loading />
        ) : names.data.length === 0 ? (
          <p className="muted">
            You don't own any domains yet. <Link to="/search">Search for one</Link>. Auctions you are bidding in are listed on the{" "}
            <Link to="/">dashboard</Link>.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Status</th>
                  <th>Resolved address</th>
                  <th>Winning bid</th>
                  <th>Date registered</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {names.data.map((n) => (
                  <tr key={n.domain}>
                    <td>
                      <strong>{fqdn(n.domain)}</strong>
                    </td>
                    <td>{n.isPrimary ? <Badge tone="blue">Primary</Badge> : <Badge tone="green">Registered</Badge>}</td>
                    <td className="mono" title={n.resolvedAddress}>
                      {shortAddress(n.resolvedAddress)}
                    </td>
                    <td>{n.price !== null ? formatEth(n.price) : "—"}</td>
                    <td>{n.registeredAt ? formatDateTime(n.registeredAt) : "—"}</td>
                    <td>
                      {!n.isPrimary && (
                        <button className="btn btn-small btn-ghost" disabled={!canTransact || busy !== null} onClick={() => setPrimary(n.domain)}>
                          {busy === n.domain ? "Setting…" : "Set primary"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
