import { PHASE_LABEL, Phase } from "../lib/chain";
import { countdown, fmtEth } from "../lib/format";
import { useMyAuctions, useMyNames, useNow, phaseEnd } from "../state/hooks";
import { useNav } from "../state/nav";
import { useAccount, useParams } from "../state/params";

export const auctionTitle = (label: string | undefined, id: bigint) => (label ? `${label}.ntu` : `Auction #${id}`);

export default function Dashboard() {
  const acct = useAccount();
  const names = useMyNames(acct);
  const auctions = useMyAuctions(acct);
  const params = useParams();
  const { go } = useNav();
  const now = useNow();

  const list = auctions.data ?? [];
  const groups = [
    { title: "Commit Phase", items: list.filter((x) => x.auction.phase === Phase.Commit) },
    { title: "Reveal Phase", items: list.filter((x) => x.auction.phase === Phase.Reveal) },
    {
      title: "Settlement",
      items: list.filter((x) => x.auction.phase === Phase.Settlement || (x.auction.phase === Phase.Closed && !x.auction.finalised) || x.canWithdraw),
    },
  ];
  const action = (x: (typeof list)[number]) => {
    switch (x.auction.phase) {
      case Phase.Commit: return "Commit bid";
      case Phase.Reveal: return "Reveal bid";
      case Phase.Settlement: return "Settle payment";
      case Phase.Closed: return "Finalise";
      default: return x.canWithdraw ? "Withdraw deposit" : "View";
    }
  };

  return (
    <>
      <h1>Dashboard</h1>
      <h2>My domains</h2>
      <div className="card">
        {!acct && <div className="muted">Connect a wallet to see your domains.</div>}
        {acct && names.data?.length === 0 && <div className="muted">You don't own any .ntu names yet. Search for one to start an auction.</div>}
        {names.data?.map((n) => (
          <div className="row" key={n.name}>
            <strong className="grow">{n.name}.ntu</strong>
            <span className={n.primary ? "status-primary" : "muted"}>{n.primary ? "Primary" : "Registered"}</span>
          </div>
        ))}
      </div>

      {groups.map((g) => (
        <div className="phases" key={g.title}>
          <div className="card count"><div className="muted">{g.title}</div><div className="n">{g.items.length}</div></div>
          <div className="card">
            {g.items.length === 0 && <div className="muted">Nothing here.</div>}
            {g.items.map((x) => {
              const end = params ? phaseEnd(x.auction, params.settlementDuration) : 0;
              const showTimer = [Phase.Commit, Phase.Reveal, Phase.Settlement].includes(x.auction.phase);
              return (
                <div className="row" key={String(x.auction.id)}>
                  <span className="grow">{auctionTitle(x.label, x.auction.id)}</span>
                  <span className="muted">{showTimer ? `${countdown(end - now / 1000)} remaining` : PHASE_LABEL[x.auction.phase]}</span>
                  <button className="link" onClick={() => go({ page: "auction", id: x.auction.id, domain: x.label })}>{action(x)}</button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {(auctions.error !== undefined || names.error !== undefined) && <div className="err">Could not load some of your data from the network.</div>}
      {params && <div className="muted small">Deposit per bid: {fmtEth(params.deposit)} ETH · minimum bid {fmtEth(params.minBid)} ETH. Countdowns are a display aid; the contract is authoritative.</div>}
    </>
  );
}
