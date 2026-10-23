import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Card, Countdown, DetailList, Loading, Notice, PhaseBadge } from "../components/ui";
import { checkAddress } from "../lib/address";
import { checkDomain, fqdn } from "../lib/domain";
import { formatEth } from "../lib/format";
import { rememberDomain } from "../lib/labels";
import { auctionIdFromReceipt, phaseDeadline } from "../lib/phase";
import { DomainLookup, Phase } from "../lib/types";
import { useAsync, useNow } from "../state/hooks";
import { useRegistry } from "../state/registry";
import { useTx } from "../state/tx";
import { useWallet } from "../state/wallet";

type SearchMode = "domain" | "address";

export function Search() {
  const [params, setParams] = useSearchParams();
  const mode: SearchMode = params.get("by") === "address" ? "address" : "domain";
  const query = params.get("q") ?? "";
  const [input, setInput] = useState(query);
  useEffect(() => setInput(query), [query]);

  const setMode = (next: SearchMode) => {
    if (next !== mode) setParams(next === "address" ? { by: "address" } : {});
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = mode === "domain" ? checkDomain(input).domain : input.trim();
    setParams({ ...(mode === "address" ? { by: "address" } : {}), ...(value ? { q: value } : {}) });
  };

  return (
    <div className="stack">
      <h1>Search .ntu domains</h1>
      <p className="muted">
        {mode === "domain"
          ? "Search a domain to check availability or current auction state."
          : "Look up an Ethereum address to find its primary .ntu domain."}
      </p>
      <div className="segmented" role="group" aria-label="Search by">
        <button type="button" className={mode === "domain" ? "active" : ""} aria-pressed={mode === "domain"} onClick={() => setMode("domain")}>
          By domain
        </button>
        <button type="button" className={mode === "address" ? "active" : ""} aria-pressed={mode === "address"} onClick={() => setMode("address")}>
          By address
        </button>
      </div>
      <form className="search-form" onSubmit={submit}>
        {mode === "domain" ? (
          <div className="input-suffix">
            <input aria-label="Domain" placeholder="e.g. alice" value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
            <span>.ntu</span>
          </div>
        ) : (
          <div className="input-suffix">
            <input aria-label="Ethereum address" className="mono" placeholder="0x…" value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
          </div>
        )}
        <button className="btn btn-primary" type="submit">
          Search
        </button>
      </form>
      <p className="hint">
        {mode === "domain" ? "3–32 characters: lowercase letters a–z and digits 0–9." : "0x followed by 40 hexadecimal characters."}
      </p>
      {query && (mode === "domain" ? <DomainQuery query={query} /> : <AddressQuery query={query} />)}
    </div>
  );
}

function DomainQuery({ query }: { query: string }) {
  const check = checkDomain(query);
  if (!check.ok) return <Notice tone="error">{check.error}</Notice>;
  return <SearchResult domain={check.domain} />;
}

// ---------------------------------------------------------------- reverse lookup (address → primary name)

function AddressQuery({ query }: { query: string }) {
  const { configured } = useRegistry();
  const check = checkAddress(query);
  if (!check.ok) return <Notice tone="error">{check.error}</Notice>;
  if (!configured)
    return <Notice tone="error">Addresses can't be looked up because no NTU Domains contract is configured for this network.</Notice>;
  return <AddressResult address={check.address} />;
}

function AddressResult({ address }: { address: string }) {
  const { registry } = useRegistry();
  const primary = useAsync(() => registry.reverseResolve(address), [registry, address]);

  if (primary.error != null && primary.data === undefined)
    return <Notice tone="error">Couldn't look up this address. Is the network reachable?</Notice>;
  if (primary.data === undefined) return <Loading what="Looking up" />;
  return (
    <Card title="Address lookup">
      <DetailList
        rows={[
          ["Address", <span className="mono break">{address}</span>],
          [
            "Primary domain",
            primary.data ? (
              <>
                <strong>{fqdn(primary.data)}</strong> <Badge tone="blue">Primary</Badge>
              </>
            ) : (
              <span className="muted">This address has no primary .ntu domain.</span>
            ),
          ],
        ]}
      />
    </Card>
  );
}

function SearchResult({ domain }: { domain: string }) {
  const { configured } = useRegistry();
  if (!configured)
    return <Notice tone="error">Domains can't be looked up because no NTU Domains contract is configured for this network.</Notice>;
  return <ConfiguredSearchResult domain={domain} />;
}

function ConfiguredSearchResult({ domain }: { domain: string }) {
  const { registry } = useRegistry();
  useEffect(() => rememberDomain(domain), [domain]);
  const lookup = useAsync(() => registry.lookup(domain), [registry, domain], 10_000);

  if (lookup.error != null && !lookup.data) return <Notice tone="error">Couldn't load this domain. Is the network reachable?</Notice>;
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
          A previous auction (#{closedPrevious.id.toString()}) for this domain closed without a winner. Starting a new auction
          finalises it automatically. <Link to={`/auction/${closedPrevious.id}?d=${domain}`}>View it</Link>
        </Notice>
      )}
      <p>
        This domain is available. Anyone can start a blind auction for it; only the domain's hash goes on-chain until bids are
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
