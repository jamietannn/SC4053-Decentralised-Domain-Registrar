import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Card, Countdown, DetailList, Loading, Notice, PhaseBadge } from "../components/ui";
import { checkDomain, fqdn } from "../lib/domain";
import { formatEth } from "../lib/format";
import { rememberDomain } from "../lib/labels";
import { auctionIdFromReceipt, phaseDeadline } from "../lib/phase";
import { DomainLookup, Phase } from "../lib/types";
import { useAsync, useNow } from "../state/hooks";
import { useRegistry } from "../state/registry";
import { useTx } from "../state/tx";
import { useWallet } from "../state/wallet";

export function Search() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [input, setInput] = useState(query);
  useEffect(() => setInput(query), [query]);
  const check = query ? checkDomain(query) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const normalized = checkDomain(input).domain;
    setParams(normalized ? { q: normalized } : {});
  };

  return (
    <div className="stack">
      <h1>Search .ntu domains</h1>
      <p className="muted">Search a name to check availability or current auction state.</p>
      <form className="search-form" onSubmit={submit}>
        <div className="input-suffix">
          <input aria-label="Domain name" placeholder="e.g. alice" value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
          <span>.ntu</span>
        </div>
        <button className="btn btn-primary" type="submit">
          Search
        </button>
      </form>
      <p className="hint">3–32 characters: lowercase letters a–z and digits 0–9.</p>
      {check && !check.ok && <Notice tone="error">{check.error}</Notice>}
      {check?.ok && <SearchResult domain={check.domain} />}
    </div>
  );
}

function SearchResult({ domain }: { domain: string }) {
  const { configured } = useRegistry();
  if (!configured)
    return <Notice tone="error">Names can't be looked up because no NtuNames contract is configured for this network.</Notice>;
  return <ConfiguredSearchResult domain={domain} />;
}

function ConfiguredSearchResult({ domain }: { domain: string }) {
  const { registry } = useRegistry();
  useEffect(() => rememberDomain(domain), [domain]);
  const lookup = useAsync(() => registry.lookup(domain), [registry, domain], 10_000);

  if (lookup.error != null && !lookup.data) return <Notice tone="error">Couldn't load this name. Is the network reachable?</Notice>;
  if (!lookup.data) return <Loading what="Looking up" />;
  return <ResultCard info={lookup.data} reload={lookup.reload} />;
}

function ResultCard({ info, reload }: { info: DomainLookup; reload: () => void }) {
  const { registry } = useRegistry();
  const cfg = useAsync(() => registry.config(), [registry]);
  const now = useNow();
  const { domain, owner, auction } = info;
  const live = auction && [Phase.Commit, Phase.Reveal, Phase.Settlement].includes(auction.phase) ? auction : null;
  const closedPrevious = auction && auction.phase === Phase.Closed ? auction : null;

  if (owner)
    return (
      <Card title={fqdn(domain)} actions={<Badge tone="green">Registered</Badge>}>
        <DetailList
          rows={[
            ["Owner", <span className="mono break">{owner}</span>],
            ["Resolves to", <span className="mono break">{owner}</span>],
          ]}
        />
        <Link className="btn btn-primary" to={`/send?to=${domain}`}>
          Send ETH to {fqdn(domain)}
        </Link>
      </Card>
    );

  if (live) {
    const deadline = cfg.data ? phaseDeadline(live, cfg.data.settlementDuration, now) : null;
    const label = live.phase === Phase.Commit ? "Commit bid" : live.phase === Phase.Reveal ? "Reveal bid" : "Settle payment";
    return (
      <Card title={fqdn(domain)} actions={<PhaseBadge phase={live.phase} />}>
        <DetailList
          rows={[
            ["Auction", `#${live.id}`],
            ["Status", deadline ? <Countdown to={deadline} /> : "—"],
            ["Bids committed", live.commitCount],
            ...(live.phase !== Phase.Commit ? ([["Bids revealed", live.revealCount]] as Array<[string, number]>) : []),
          ]}
        />
        <Link className="btn btn-primary" to={`/auction/${live.id}?d=${domain}`}>
          {label}
        </Link>
      </Card>
    );
  }

  return (
    <Card title={fqdn(domain)} actions={<Badge tone="green">Available</Badge>}>
      {closedPrevious && (
        <Notice>
          A previous auction (#{closedPrevious.id.toString()}) for this name closed without a winner. Starting a new auction
          finalises it automatically. <Link to={`/auction/${closedPrevious.id}?d=${domain}`}>View it</Link>
        </Notice>
      )}
      <p>
        This name is available. Anyone can start a blind auction for it; only the name's hash goes on-chain until bids are
        revealed.
      </p>
      {cfg.data && (
        <DetailList
          rows={[
            ["Commit phase", `${cfg.data.commitDuration / 60} min`],
            ["Reveal phase", `${cfg.data.revealDuration / 60} min`],
            ["Settlement window", `${cfg.data.settlementDuration / 60} min per bidder`],
            ["Deposit per bid", formatEth(cfg.data.deposit)],
            ["Minimum bid", formatEth(cfg.data.minBid)],
          ]}
        />
      )}
      <StartAuctionButton domain={domain} nameHash={info.nameHash} onStarted={reload} />
    </Card>
  );
}

export function StartAuctionButton({ domain, nameHash, onStarted }: { domain: string; nameHash: string; onStarted?: () => void }) {
  const { canTransact } = useWallet();
  const { run } = useTx();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    const result = await run(`Start auction (${fqdn(domain)})`, (r) => r.startAuction(nameHash));
    setBusy(false);
    if (!result) return;
    onStarted?.();
    const id = auctionIdFromReceipt(result.receipt);
    if (id !== null) navigate(`/auction/${id}?d=${domain}`);
  };

  return (
    <div className="stack-tight">
      <button className="btn btn-primary" onClick={start} disabled={!canTransact || busy}>
        {busy ? "Starting…" : "Start auction"}
      </button>
      {!canTransact && <p className="hint">Connect your wallet on the correct network to start an auction.</p>}
    </div>
  );
}
