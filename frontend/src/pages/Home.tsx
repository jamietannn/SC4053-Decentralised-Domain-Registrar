import { Link } from "react-router-dom";
import { Badge, Card, Countdown, Loading, Notice, PhaseBadge } from "../components/ui";
import { fqdn } from "../lib/domain";
import { formatEth, shortHash } from "../lib/format";
import { phaseDeadline } from "../lib/phase";
import { MyAuction, Phase } from "../lib/types";
import { useAsync, useNow } from "../state/hooks";
import { useRegistry } from "../state/registry";
import { useWallet } from "../state/wallet";

export function Home() {
  const { account } = useWallet();
  return account ? <Dashboard account={account} /> : <Landing />;
}

function Landing() {
  const wallet = useWallet();
  return (
    <div className="landing">
      <h1>Own your identity on-chain.</h1>
      <p className="lead">Register, manage and resolve .ntu domains using a compatible Ethereum wallet.</p>
      <Notice tone="warn">Never enter your seed phrase or private key. NTU Domains will never ask for them.</Notice>
      <div className="row">
        <button className="btn btn-primary btn-large" onClick={wallet.connect} disabled={wallet.connecting}>
          {wallet.connecting ? "Connecting…" : "Connect MetaMask"}
        </button>
        <Link className="btn btn-ghost btn-large" to="/search">
          Search domains without connecting
        </Link>
      </div>
      {!wallet.available && (
        <p className="muted">
          MetaMask was not detected in this browser. You can still search and resolve domains, or{" "}
          <a href="?demo=1">browse the demo</a>.
        </p>
      )}
    </div>
  );
}

type DashboardRow = MyAuction & { canWithdraw: boolean };

const GROUPS: Array<{ title: string; phases: Phase[] }> = [
  { title: "Commit phase", phases: [Phase.Commit] },
  { title: "Reveal phase", phases: [Phase.Reveal] },
  { title: "Settlement", phases: [Phase.Settlement] },
  { title: "Finished auctions", phases: [Phase.Settled, Phase.Closed] },
];

function Dashboard({ account }: { account: string }) {
  const { registry } = useRegistry();
  const names = useAsync(() => registry.ownedNames(account), [registry, account], 30_000);
  const auctions = useAsync<DashboardRow[]>(
    async () => {
      const mine = await registry.myAuctions(account);
      return Promise.all(mine.map(async (m) => ({ ...m, canWithdraw: await registry.canWithdraw(m.auction.id, account) })));
    },
    [registry, account],
    10_000,
  );

  return (
    <div className="stack">
      <h1>Dashboard</h1>
      <div className="grid-2">
        <Card title="My domains" actions={<Link to="/domains">Manage</Link>}>
          {names.loading && !names.data ? (
            <Loading />
          ) : names.data?.length ? (
            <ul className="plain-list">
              {names.data.map((n) => (
                <li key={n.domain}>
                  <strong>{fqdn(n.domain)}</strong> {n.isPrimary ? <Badge tone="blue">Primary</Badge> : <Badge tone="green">Registered</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              You don't own any domains yet. <Link to="/search">Search for one</Link>.
            </p>
          )}
        </Card>
        <Card title="Quick actions">
          <div className="stack-tight">
            <Link className="btn btn-primary" to="/search">Search domains</Link>
            <Link className="btn btn-ghost" to="/send">Send ETH to a .ntu domain</Link>
            <Link className="btn btn-ghost" to="/history">Transaction history</Link>
          </div>
        </Card>
      </div>

      {auctions.error != null && !auctions.data && <Notice tone="error">Couldn't load your auctions.</Notice>}
      {auctions.loading && !auctions.data && <Loading what="Loading your auctions" />}
      {auctions.data && auctions.data.length === 0 && (
        <Card title="My auctions">
          <p className="muted">You haven't bid in any auctions yet.</p>
        </Card>
      )}
      {auctions.data &&
        GROUPS.map((g) => {
          const rows = auctions.data!.filter((r) => g.phases.includes(r.auction.phase));
          if (rows.length === 0) return null;
          return (
            <Card key={g.title} title={`${g.title} (${rows.length})`}>
              <ul className="auction-list">
                {rows.map((r) => (
                  <AuctionRow key={r.auction.id.toString()} row={r} account={account} />
                ))}
              </ul>
            </Card>
          );
        })}
    </div>
  );
}

function AuctionRow({ row, account }: { row: DashboardRow; account: string }) {
  const { registry } = useRegistry();
  const cfg = useAsync(() => registry.config(), [registry]);
  const now = useNow();
  const { auction, bid, domain } = row;
  const deadline = cfg.data ? phaseDeadline(auction, cfg.data.settlementDuration, now) : null;
  const href = `/auction/${auction.id}${domain ? `?d=${domain}` : ""}`;

  let action = "View";
  let note = "";
  if (auction.phase === Phase.Commit) note = "Bid committed";
  else if (auction.phase === Phase.Reveal) action = bid.revealed ? "View" : "Reveal bid";
  else if (auction.phase === Phase.Settlement) action = bid.eligible ? "Settle payment" : "View";
  else if (row.canWithdraw) action = "Withdraw deposit";
  if (auction.phase === Phase.Reveal && bid.revealed) note = bid.eligible ? `Revealed ${formatEth(bid.amount)}` : "Revealed (ineligible)";
  if (auction.phase === Phase.Settled)
    note = auction.winner === account ? `Won for ${formatEth(auction.winningBid)}` : bid.withdrawn ? "Deposit refunded" : "Not won";
  if (auction.phase === Phase.Closed) note = bid.withdrawn ? "Closed · deposit refunded" : "Closed without a winner";

  return (
    <li className="auction-row">
      <span className="auction-name">{domain ? fqdn(domain) : <span className="mono">{shortHash(auction.nameHash)}</span>}</span>
      <PhaseBadge phase={auction.phase} />
      <span className="muted">{deadline ? <Countdown to={deadline} /> : note}</span>
      {deadline && note && <span className="muted">{note}</span>}
      <Link className={action === "View" ? "btn btn-small btn-ghost" : "btn btn-small btn-primary"} to={href}>
        {action}
      </Link>
    </li>
  );
}
