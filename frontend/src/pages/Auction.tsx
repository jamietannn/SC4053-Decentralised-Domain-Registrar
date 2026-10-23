import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Card, CopyButton, Countdown, DetailList, Loading, Notice, PhaseBadge, SgdHint, TxLink } from "../components/ui";
import { commitBlocker } from "../lib/commitGate";
import { computeCommitment, generateSalt, parseSalt } from "../lib/commitment";
import { checkDomain, fqdn, isValidDomain, nameHash } from "../lib/domain";
import { formatDateTime, formatEth, parseEthInput, shortAddress, shortHash } from "../lib/format";
import { knownDomain, rememberDomain } from "../lib/labels";
import { phaseDeadline, settlementWindow } from "../lib/phase";
import { AuctionInfo, BidInfo, INELIGIBILITY_LABEL, Ineligibility, Phase, RankInfo, RegistryConfig } from "../lib/types";
import { useAsync, useNow } from "../state/hooks";
import { useRegistry } from "../state/registry";
import { TxResult, useTx } from "../state/tx";
import { useWallet } from "../state/wallet";
import { StartAuctionButton } from "./Search";

type Confirmation = { title: string; rows: Array<[ReactNode, ReactNode]>; hash: string; note?: ReactNode };

type PageData = {
  cfg: RegistryConfig;
  auction: AuctionInfo;
  bid: BidInfo | null;
  rank: RankInfo | null;
  canWithdraw: boolean;
  offeree: string | null;
};

const ZERO_HASH = "0x" + "0".repeat(64);

export function AuctionPage() {
  const { id: idParam = "" } = useParams();
  if (!/^\d+$/.test(idParam)) return <Notice tone="error">Invalid auction id.</Notice>;
  return <AuctionView id={BigInt(idParam)} />;
}

function AuctionView({ id }: { id: bigint }) {
  const { registry } = useRegistry();
  const { account } = useWallet();
  const [params] = useSearchParams();
  const now = useNow();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [typedDomain, setTypedDomain] = useState<string | null>(null);

  const state = useAsync<PageData>(
    async () => {
      const [cfg, auction] = await Promise.all([registry.config(), registry.auction(id)]);
      const [bid, rank, canWithdraw] = account
        ? await Promise.all([registry.bid(id, account), registry.rank(id, account), registry.canWithdraw(id, account)])
        : [null, null, false];
      const offeree = auction.phase === Phase.Settlement ? await registry.currentOfferee(id) : null;
      return { cfg, auction, bid, rank, canWithdraw, offeree };
    },
    [registry, id, account],
    5_000,
  );

  // Re-read contract state as soon as the displayed phase deadline passes (the contract stays authoritative).
  const data = state.data;
  const deadline = data ? phaseDeadline(data.auction, data.cfg.settlementDuration, now) : null;
  const reloadedFor = useRef<number | null>(null);
  useEffect(() => {
    if (deadline !== null && now >= deadline && reloadedFor.current !== deadline) {
      reloadedFor.current = deadline;
      state.reload();
    }
  }, [deadline, now, state]);

  if (state.error != null && !data) return <Notice tone="error">Couldn't load auction #{id.toString()}.</Notice>;
  if (!data) return <Loading what="Loading auction" />;
  const { auction } = data;
  if (auction.phase === Phase.None) return <Notice tone="error">Auction #{id.toString()} does not exist.</Notice>;

  const hinted = params.get("d");
  const domain =
    auction.domain ||
    (hinted && isValidDomain(hinted) && nameHash(hinted) === auction.nameHash ? hinted : null) ||
    typedDomain ||
    knownDomain(auction.nameHash);
  const title = domain ? fqdn(domain) : `Auction #${id} (domain not yet revealed)`;

  const done = (c: Confirmation) => {
    setConfirmation(c);
    state.reload();
  };

  if (confirmation)
    return (
      <div className="stack">
        <h1>{confirmation.title}</h1>
        <Card>
          <DetailList rows={[...confirmation.rows, ["Transaction", <TxLink hash={confirmation.hash} />]]} />
          {confirmation.note}
          <div className="row">
            <Link className="btn btn-primary" to="/">
              Back to Home
            </Link>
            <button className="btn btn-ghost" onClick={() => setConfirmation(null)}>
              Back to auction
            </button>
          </div>
        </Card>
      </div>
    );

  return (
    <div className="stack">
      <div className="title-row">
        <h1>{title}</h1>
        <PhaseBadge phase={auction.phase} />
      </div>
      <AuctionSummary data={data} deadline={deadline} />
      {!account ? (
        <Notice>Connect your wallet to bid, reveal, pay or withdraw.</Notice>
      ) : (
        <ActionPanel data={data} account={account} domain={domain} setTypedDomain={setTypedDomain} onDone={done} reload={state.reload} />
      )}
    </div>
  );
}

function AuctionSummary({ data, deadline }: { data: PageData; deadline: number | null }) {
  const { auction, cfg } = data;
  const settlementEnd = auction.revealDeadline + auction.eligibleCount * cfg.settlementDuration;
  return (
    <Card>
      <DetailList
        rows={[
          ["Auction", `#${auction.id} · domain hash ${shortHash(auction.nameHash)}`],
          ...(deadline ? ([["Time left in phase", <Countdown to={deadline} />]] as Array<[ReactNode, ReactNode]>) : []),
          ["Commit deadline", formatDateTime(auction.commitDeadline)],
          ["Reveal deadline", formatDateTime(auction.revealDeadline)],
          ...(auction.phase >= Phase.Settlement && auction.eligibleCount > 0 && !auction.settled
            ? ([["Last settlement window ends", formatDateTime(settlementEnd)]] as Array<[ReactNode, ReactNode]>)
            : []),
          ["Bids committed / revealed / eligible", `${auction.commitCount} / ${auction.revealCount} / ${auction.eligibleCount}`],
          ["Deposit · minimum bid", `${formatEth(cfg.deposit)} · ${formatEth(cfg.minBid)}`],
          ...(auction.settled
            ? ([
                ["Winner", <span className="mono">{shortAddress(auction.winner)}</span>],
                ["Final price", formatEth(auction.winningBid)],
              ] as Array<[ReactNode, ReactNode]>)
            : []),
        ]}
      />
    </Card>
  );
}

type PanelProps = {
  data: PageData;
  account: string;
  domain: string | null;
  setTypedDomain: (d: string) => void;
  onDone: (c: Confirmation) => void;
  reload: () => void;
};

function ActionPanel(props: PanelProps) {
  const { auction, bid } = props.data;
  const committed = !!bid && bid.commitment !== ZERO_HASH;
  switch (auction.phase) {
    case Phase.Commit:
      if (committed)
        return (
          <Card title="Your bid is committed">
            <p>
              Reveal opens at <strong>{formatDateTime(auction.commitDeadline)}</strong> and closes at{" "}
              <strong>{formatDateTime(auction.revealDeadline)}</strong>. Keep your domain, bid and salt ready — if you do not
              reveal in time, your deposit is forfeited.
            </p>
          </Card>
        );
      if (!props.domain) return <DomainPrompt nameHashValue={auction.nameHash} onDomain={props.setTypedDomain} />;
      return <CommitPanel {...props} domain={props.domain} />;
    case Phase.Reveal:
      if (!committed) return <Notice>Bidding has closed. You did not commit a bid in this auction.</Notice>;
      if (!bid!.revealed) return <RevealPanel {...props} bid={bid!} />;
      return <RevealedPanel {...props} bid={bid!} />;
    case Phase.Settlement:
      return <SettlementPanel {...props} committed={committed} />;
    case Phase.Settled:
    case Phase.Closed:
      return <OutcomePanel {...props} committed={committed} />;
    default:
      return null;
  }
}

function DomainPrompt({ nameHashValue, onDomain }: { nameHashValue: string; onDomain: (d: string) => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const check = checkDomain(input);
    if (!check.ok) return setError(check.error);
    if (nameHash(check.domain) !== nameHashValue) return setError(`${fqdn(check.domain)} is not the domain this auction is for.`);
    rememberDomain(check.domain);
    onDomain(check.domain);
  };
  return (
    <Card title="Which domain is this auction for?">
      <p className="muted">Only the domain's hash is on-chain until bids are revealed. Enter the domain to bid on it.</p>
      <form className="search-form" onSubmit={submit}>
        <div className="input-suffix">
          <input aria-label="Domain" value={input} onChange={(e) => setInput(e.target.value)} />
          <span>.ntu</span>
        </div>
        <button className="btn btn-primary">Continue</button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
    </Card>
  );
}

// ---------------------------------------------------------------- commit

function CommitPanel({ data, domain, onDone }: PanelProps & { domain: string }) {
  const { cfg, auction } = data;
  const { canTransact } = useWallet();
  const { run } = useTx();
  const [bidInput, setBidInput] = useState("");
  const [salt, setSalt] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);

  const bidWei = parseEthInput(bidInput);
  const blocker = commitBlocker({
    canTransact,
    inCommitPhase: auction.phase === Phase.Commit,
    alreadyCommitted: false,
    bidWei,
    salt,
    acknowledged,
  });
  const backup = salt && bidWei !== null ? `domain: ${domain}\nbid (wei): ${bidWei}\nsalt: ${salt}` : "";

  const submit = async () => {
    if (blocker || !salt || bidWei === null) return;
    setBusy(true);
    const commitment = computeCommitment(domain, bidWei, salt);
    const result: TxResult | null = await run(`Commit bid (${fqdn(domain)})`, (r) =>
      r.commitBid(auction.id, commitment, { value: cfg.deposit }),
    );
    setBusy(false);
    if (!result) return;
    onDone({
      title: "Bid confirmation",
      hash: result.hash,
      rows: [
        ["Domain", fqdn(domain)],
        ["Bid amount", formatEth(bidWei)],
        ["Deposit paid", formatEth(cfg.deposit)],
        ["Time committed", formatDateTime(result.timestamp)],
      ],
      note: (
        <Notice tone="warn">
          Reveal between {formatDateTime(auction.commitDeadline)} and {formatDateTime(auction.revealDeadline)} using exactly:
          <pre className="secret">{backup}</pre>
        </Notice>
      ),
    });
  };

  return (
    <Card title="Commit bid">
      <p className="muted">
        {fqdn(domain)} · Commit phase. Place a hidden bid before the commit deadline. Only a hash of your domain, bid and salt
        is sent; you pay a fixed {formatEth(cfg.deposit)} deposit now, which counts toward the price if you win.
      </p>
      <label className="field">
        <span>Bid amount (ETH)</span>
        <input
          inputMode="decimal"
          placeholder="0.50"
          value={bidInput}
          onChange={(e) => {
            setBidInput(e.target.value);
            setAcknowledged(false);
          }}
        />
      </label>
      {bidWei === null ? bidInput && <p className="hint">Enter a valid ETH amount.</p> : <SgdHint wei={bidWei} />}
      {bidWei !== null && bidWei < cfg.minBid && (
        <Notice tone="warn">
          Bids below the {formatEth(cfg.minBid)} minimum cannot win. Your deposit would be refundable after you reveal.
        </Notice>
      )}

      <div className="field">
        <span>Salt / secret backup</span>
        {salt ? (
          <div className="secret-box">
            <pre className="secret">{backup || `salt: ${salt}`}</pre>
            <div className="row">
              <CopyButton value={salt} label="Copy salt" />
              {backup && <CopyButton value={backup} label="Copy domain, bid & salt" />}
              <button
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() => {
                  setSalt(generateSalt());
                  setAcknowledged(false);
                }}
              >
                Regenerate
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setSalt(generateSalt())}>
            Generate random salt
          </button>
        )}
      </div>
      <Notice tone="warn">
        Never lose the salt: the reveal step must use the exact committed domain, bid and salt. NTU Domains does not store it.
        If you don't reveal, your deposit is forfeited.
      </Notice>
      <label className="checkbox">
        <input type="checkbox" checked={acknowledged} disabled={!salt || bidWei === null} onChange={(e) => setAcknowledged(e.target.checked)} />
        I understand that I must save my domain, bid amount and salt, and that I have saved them.
      </label>
      <button className="btn btn-primary" disabled={!!blocker || busy} onClick={submit}>
        {busy ? "Committing…" : `Commit bid (pay ${formatEth(cfg.deposit)} deposit)`}
      </button>
      {blocker && <p className="hint">{blocker}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- reveal

function RevealPanel({ data, domain, bid, onDone }: PanelProps & { bid: BidInfo }) {
  const { cfg, auction } = data;
  const { canTransact } = useWallet();
  const { run } = useTx();
  const [domainInput, setDomainInput] = useState(domain ?? "");
  const [bidInput, setBidInput] = useState("");
  const [saltInput, setSaltInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const revealDomain = domainInput.trim().toLowerCase().replace(/\.ntu$/, "");
  const bidWei = parseEthInput(bidInput);
  const salt = parseSalt(saltInput);
  const predicted: Ineligibility = !isValidDomain(revealDomain)
    ? Ineligibility.InvalidDomain
    : nameHash(revealDomain) !== auction.nameHash
      ? Ineligibility.WrongDomain
      : bidWei !== null && bidWei < cfg.minBid
        ? Ineligibility.BelowMinimum
        : Ineligibility.None;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (bidWei === null) return setError("Enter the exact bid amount you committed, in ETH.");
    if (!salt) return setError("The salt must be 64 hexadecimal characters (optionally starting with 0x).");
    // Check locally first so a wrong secret never costs gas (AC54).
    if (computeCommitment(revealDomain, bidWei, salt) !== bid.commitment)
      return setError("These details don't match your commitment. Check the domain, the exact bid amount and the salt.");
    setBusy(true);
    const result = await run(`Reveal bid (${fqdn(revealDomain)})`, (r) => r.revealBid(auction.id, revealDomain, bidWei, salt));
    setBusy(false);
    if (!result) return;
    onDone({
      title: "Bid revealed",
      hash: result.hash,
      rows: [
        ["Domain", fqdn(revealDomain)],
        ["Bid amount", formatEth(bidWei)],
        ["Result", predicted === Ineligibility.None ? "Eligible" : `Ineligible — ${INELIGIBILITY_LABEL[predicted]}`],
        ["Time revealed", formatDateTime(result.timestamp)],
      ],
      note: (
        <p className="muted">
          {predicted === Ineligibility.None
            ? `Results are known after ${formatDateTime(auction.revealDeadline)}. Come back then to pay if you are the highest bidder.`
            : "You can withdraw your deposit from the auction page now."}
        </p>
      ),
    });
  };

  return (
    <Card title="Reveal bid">
      <p className="muted">Enter the domain, bid and salt you saved when committing. Reveal closes at {formatDateTime(auction.revealDeadline)}.</p>
      <form className="stack-tight" onSubmit={submit}>
        <label className="field">
          <span>Domain</span>
          <div className="input-suffix">
            <input value={domainInput} onChange={(e) => setDomainInput(e.target.value)} />
            <span>.ntu</span>
          </div>
        </label>
        <label className="field">
          <span>Bid amount (ETH)</span>
          <input inputMode="decimal" value={bidInput} onChange={(e) => setBidInput(e.target.value)} />
        </label>
        <SgdHint wei={bidWei} />
        <label className="field">
          <span>Saved salt</span>
          <input className="mono" value={saltInput} onChange={(e) => setSaltInput(e.target.value)} placeholder="0x…" />
        </label>
        {bidWei !== null && salt && predicted !== Ineligibility.None && (
          <Notice tone="warn">
            This reveal will be ineligible ({INELIGIBILITY_LABEL[predicted]}), so it cannot win. Revealing still lets you withdraw
            your deposit right away.
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn btn-primary" disabled={!canTransact || busy}>
          {busy ? "Revealing…" : "Reveal bid"}
        </button>
      </form>
    </Card>
  );
}

function RevealedPanel({ data, bid, onDone, domain }: PanelProps & { bid: BidInfo }) {
  return (
    <Card title="Bid revealed">
      {bid.eligible ? (
        <p>
          Your bid of <strong>{formatEth(bid.amount)}</strong> is eligible. Results are known after{" "}
          {formatDateTime(data.auction.revealDeadline)}.
        </p>
      ) : (
        <>
          <p>Your reveal was recorded as ineligible: {INELIGIBILITY_LABEL[bid.reason]}. It cannot win.</p>
          {data.canWithdraw && <WithdrawButton data={data} domain={domain} onDone={onDone} />}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- settlement & outcome

function SettlementPanel({ data, account, domain, onDone, committed }: PanelProps & { committed: boolean }) {
  const { cfg, auction, bid, rank, offeree } = data;
  const now = useNow();
  const { canTransact } = useWallet();
  const { run } = useTx();
  const [busy, setBusy] = useState(false);

  if (!committed || !bid) return <Notice>Settlement in progress. You did not bid in this auction.</Notice>;
  if (!bid.revealed) return <Notice tone="warn">You did not reveal your bid, so your deposit is forfeited.</Notice>;
  if (!bid.eligible)
    return (
      <Card title="Auction results & settlement">
        <p>Your reveal was ineligible ({INELIGIBILITY_LABEL[bid.reason]}).</p>
        {data.canWithdraw ? <WithdrawButton data={data} domain={domain} onDone={onDone} /> : <p className="muted">Deposit already withdrawn.</p>}
      </Card>
    );

  const due = bid.amount - cfg.deposit;
  const window = settlementWindow(auction.revealDeadline, cfg.settlementDuration, now);
  const myTurn = offeree === account;

  const pay = async () => {
    setBusy(true);
    const result = await run(`Pay winning bid (${domain ? fqdn(domain) : `auction #${auction.id}`})`, (r) =>
      r.payWinningBid(auction.id, { value: due }),
    );
    setBusy(false);
    if (!result) return;
    onDone({
      title: "Payment confirmation",
      hash: result.hash,
      rows: [
        ["Domain", domain ? fqdn(domain) : `auction #${auction.id}`],
        ["Final price", formatEth(bid.amount)],
        ["Paid now (price − deposit)", formatEth(due)],
        ["Timestamp", formatDateTime(result.timestamp)],
      ],
      note: <p>The domain is now registered to you and resolves to your address.</p>,
    });
  };

  if (myTurn && rank)
    return (
      <Card title="Congratulations, you won!">
        <DetailList
          rows={[
            ["Final price", formatEth(bid.amount)],
            ["Deposit already paid", formatEth(cfg.deposit)],
            ["Amount due now", <strong>{formatEth(due)}</strong>],
            ["Pay before", <>{formatDateTime(rank.windowEnd)} (<Countdown to={rank.windowEnd} />)</>],
          ]}
        />
        <button className="btn btn-primary" onClick={pay} disabled={!canTransact || busy}>
          {busy ? "Paying…" : `Pay winning bid (${formatEth(due)})`}
        </button>
        <p className="hint">If you don't pay in time, your deposit is forfeited and the next-highest bidder gets the offer.</p>
      </Card>
    );

  if (rank && rank.rank > window)
    return (
      <Card title="Auction results & settlement">
        <p>
          You are ranked <strong>#{rank.rank + 1}</strong> with {formatEth(bid.amount)}. If every higher bidder fails to pay, your
          payment window opens at <strong>{formatDateTime(rank.windowStart)}</strong> (<Countdown to={rank.windowStart} suffix="until then" />).
        </p>
        <p className="muted">If a higher bidder pays, your deposit becomes withdrawable.</p>
      </Card>
    );

  return (
    <Card title="Auction results & settlement">
      <p>Your payment window has passed without payment, so your deposit is forfeited.</p>
    </Card>
  );
}

function OutcomePanel({ data, account, domain, onDone, reload, committed }: PanelProps & { committed: boolean }) {
  const { auction, bid } = data;
  const { canTransact } = useWallet();
  const { run } = useTx();
  const [busy, setBusy] = useState(false);

  const finalise = async () => {
    setBusy(true);
    await run(`Finalise auction #${auction.id}`, (r) => r.finalise(auction.id));
    setBusy(false);
    reload();
  };

  let mine: ReactNode = null;
  if (committed && bid) {
    if (auction.winner === account) mine = <p>You won this auction. {domain && <Link to="/domains">Manage {fqdn(domain)}</Link>}</p>;
    else if (data.canWithdraw)
      mine = (
        <>
          <p>You did not win the bid for this domain. Please proceed to withdraw your deposit.</p>
          <WithdrawButton data={data} domain={domain} onDone={onDone} />
        </>
      );
    else if (bid.withdrawn) mine = <p>Your deposit has been refunded.</p>;
    else if (!bid.revealed) mine = <p>You did not reveal your bid, so your deposit was forfeited.</p>;
    else mine = <p>Your payment window passed without payment, so your deposit was forfeited.</p>;
  }

  return (
    <Card title="Auction results & settlement">
      {auction.phase === Phase.Settled ? (
        <p>
          {domain ? fqdn(domain) : "This domain"} was registered to <span className="mono">{shortAddress(auction.winner)}</span> for{" "}
          {formatEth(auction.winningBid)}.
        </p>
      ) : (
        <p>This auction closed without a winner. The domain is available for a new auction.</p>
      )}
      {mine}
      {auction.phase === Phase.Closed && (
        <div className="row">
          {!auction.finalised && (
            <button className="btn btn-ghost" onClick={finalise} disabled={!canTransact || busy}>
              Finalise auction
            </button>
          )}
          {domain && <StartAuctionButton domain={domain} nameHash={auction.nameHash} />}
        </div>
      )}
    </Card>
  );
}

function WithdrawButton({ data, domain, onDone }: { data: PageData; domain: string | null; onDone: (c: Confirmation) => void }) {
  const { canTransact } = useWallet();
  const { run } = useTx();
  const [busy, setBusy] = useState(false);
  const label = domain ? fqdn(domain) : `auction #${data.auction.id}`;
  const withdraw = async () => {
    setBusy(true);
    const result = await run(`Withdraw deposit (${label})`, (r) => r.withdrawDeposit(data.auction.id));
    setBusy(false);
    if (!result) return;
    onDone({
      title: "Refund confirmation",
      hash: result.hash,
      rows: [
        ["Domain", label],
        ["Amount", formatEth(data.cfg.deposit)],
        ["Timestamp", formatDateTime(result.timestamp)],
      ],
    });
  };
  return (
    <button className="btn btn-primary" onClick={withdraw} disabled={!canTransact || busy}>
      {busy ? "Withdrawing…" : `Withdraw deposit (${formatEth(data.cfg.deposit)})`}
    </button>
  );
}
