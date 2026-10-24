import { useEffect, useState } from "react";
import { Phase, PHASE_LABEL, REASON_LABEL, loadAuction, readContract, withSigner, type AuctionInfo } from "../lib/chain";
import { DEMO } from "../lib/config";
import { demoAuctions } from "../lib/demo";
import { commitmentOf, hasCommitment, isSalt, nameHash, normalise, parseEthAmount, randomSalt, validateDomain } from "../lib/domain";
import { countdown, fmtDate, fmtEth } from "../lib/format";
import { labelFor, rememberLabel } from "../lib/labels";
import { CopyButton, TxButton } from "../components";
import { phaseEnd, useNow, usePoll, useRate } from "../state/hooks";
import { useNav } from "../state/nav";
import { useAccount, useParams } from "../state/params";
import { useTx } from "../state/tx";
import { useWallet } from "../state/wallet";
import { rateIsFresh } from "../lib/sgd";

interface MyState {
  commitment: string; revealed: boolean; eligible: boolean; reason: number; bid: bigint; withdrawn: boolean; canWithdraw: boolean;
  rank?: number; windowStart?: number; windowEnd?: number; due?: bigint; offeree?: string;
}

async function loadMine(id: bigint, acct: string): Promise<MyState> {
  const [b, canWithdraw, offeree] = await Promise.all([readContract.getBid(id, acct), readContract.canWithdraw(id, acct), readContract.currentOfferee(id)]);
  const s: MyState = { commitment: b.commitment, revealed: b.revealed, eligible: b.eligible, reason: Number(b.reason), bid: b.bid, withdrawn: b.withdrawn, canWithdraw, offeree };
  if (b.eligible) {
    const [r, due] = await Promise.all([readContract.rankOf(id, acct), readContract.amountDue(id, acct)]);
    s.rank = Number(r.rank); s.windowStart = Number(r.windowStart); s.windowEnd = Number(r.windowEnd); s.due = due;
  }
  return s;
}

export default function Auction({ id, knownDomain }: { id: bigint; knownDomain?: string }) {
  const acct = useAccount();
  const { signer } = useWallet();
  const { run } = useTx();
  const { go } = useNav();
  const params = useParams();
  const now = useNow();

  const a = usePoll<AuctionInfo | undefined>(async () => (DEMO ? demoAuctions().find((x) => x.auction.id === id)?.auction : loadAuction(id)), [id]);
  const me = usePoll<MyState | null>(async () => (acct && !DEMO ? loadMine(id, acct) : null), [id, acct]);

  const [typed, setTyped] = useState("");
  const info = a.data;
  if (a.loading) return <p className="muted">Loading auction…</p>;
  if (!info || info.phase === Phase.None) return <><h1>Auction not found</h1><button className="link" onClick={() => go({ page: "search" })}>Back to search</button></>;

  const cached = knownDomain ?? labelFor(info.nameHash);
  const typedNorm = normalise(typed);
  const typedOk = !!typed && !validateDomain(typedNorm) && nameHash(typedNorm) === info.nameHash;
  const domain = cached ?? (typedOk ? typedNorm : undefined);
  const m = me.data;
  const mine = !!m && hasCommitment(m.commitment);
  const end = params ? phaseEnd(info, params.settlementDuration) : 0;
  const timed = [Phase.Commit, Phase.Reveal, Phase.Settlement].includes(info.phase);
  const title = domain ? `${domain}.ntu` : `Auction #${info.id}`;

  return (
    <>
      <h1>{{ [Phase.Commit]: "Commit bid", [Phase.Reveal]: "Reveal bid", [Phase.Settlement]: "Auction results & settlement" }[info.phase as number] ?? "Auction"}</h1>
      <h2 style={{ marginTop: 0 }}>{title} · {PHASE_LABEL[info.phase]}</h2>
      {timed && <p className="muted">{countdown(end - now / 1000)} remaining in this phase</p>}

      {!domain && (
        <div className="card" style={{ maxWidth: 620 }}>
          <label style={{ marginTop: 0 }}>Which name is this auction for?</label>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. alice" />
          <div className="muted small">The contract only stores a hash of the name, so enter the name you want to bid on.</div>
          {typed && !typedOk && <div className="err">That name does not match this auction.</div>}
        </div>
      )}

      {info.phase === Phase.Commit && domain && <CommitForm id={id} domain={domain} committed={mine} deposit={params?.deposit} minBid={params?.minBid} />}
      {info.phase === Phase.Commit && !domain && null}
      {info.phase === Phase.Reveal && <RevealForm id={id} knownDomain={domain} mine={m} minBid={params?.minBid} />}

      {info.phase === Phase.Settlement && (
        <div style={{ maxWidth: 620 }}>
          {m?.eligible && m.offeree?.toLowerCase() === acct?.toLowerCase() && (
            <div className="card win">
              <h3>Congratulations, you won!</h3>
              <div className="ok" style={{ fontSize: "1.3rem" }}>{title}</div>
              <p>Final price: {fmtEth(m.bid)} ETH<br /><span className="muted small">You pay {fmtEth(m.due!)} ETH now; your {params ? fmtEth(params.deposit) : ""} ETH deposit is credited.</span></p>
              <p className="muted small">Pay before {fmtDate(m.windowEnd!)}, or the name is offered to the next bidder and your deposit is forfeited.</p>
              <TxButton onClick={() => run(`Pay winning bid (${title})`, () => withSigner(signer!).payWinningBid(id, { value: m.due }), { amount: `${fmtEth(m.bid)} ETH` })}>Pay winning bid</TxButton>
            </div>
          )}
          {m?.eligible && m.offeree?.toLowerCase() !== acct?.toLowerCase() && (
            <div className="card">
              <p><strong>You are ranked #{m.rank! + 1}.</strong></p>
              {now / 1000 < m.windowStart! && <p>Your payment window opens at {fmtDate(m.windowStart!)} if the higher bidders do not pay.</p>}
              {now / 1000 >= m.windowEnd! && <p className="err">Your payment window has passed.</p>}
            </div>
          )}
          {mine && !m?.eligible && m?.revealed && <div className="card">Your bid was ineligible ({REASON_LABEL[m.reason]}).</div>}
          {mine && !m?.revealed && <div className="card err">You did not reveal your bid, so your deposit is forfeited.</div>}
          {!mine && <div className="card muted">Bidders are being offered the name in rank order. Current offeree: <span className="mono">{m?.offeree ?? "…"}</span></div>}
        </div>
      )}

      {info.phase === Phase.Closed && !info.finalised && (
        <div className="card" style={{ maxWidth: 620 }}>
          <p>This auction ended without a winner. Anyone can finalise it to settle the forfeited deposits; the name can then be auctioned again.</p>
          <TxButton onClick={() => run(`Finalise auction (${title})`, () => withSigner(signer!).finalise(id))}>Finalise auction</TxButton>
        </div>
      )}
      {info.phase === Phase.Closed && info.finalised && <div className="card" style={{ maxWidth: 620 }}>Closed with no winner. The name is available again.</div>}

      {info.phase === Phase.Settled && (
        <div className={`card ${info.winner.toLowerCase() === acct?.toLowerCase() ? "win" : ""}`} style={{ maxWidth: 620 }}>
          {info.winner.toLowerCase() === acct?.toLowerCase()
            ? <><h3 className="ok">You own {title}</h3><p>Final price: {fmtEth(info.winningBid)} ETH</p></>
            : <><strong>Auction settled.</strong><p>Winner: <span className="mono">{info.winner}</span> for {fmtEth(info.winningBid)} ETH.</p></>}
        </div>
      )}

      {m?.canWithdraw && (
        <div className="card" style={{ maxWidth: 620 }}>
          <strong>Your deposit is available.</strong>
          <p className="muted small">{m.eligible ? "You did not win. " : `Your bid was ineligible (${REASON_LABEL[m.reason]}). `}You can withdraw your {params ? fmtEth(params.deposit) : ""} ETH deposit.</p>
          <TxButton onClick={() => run(`Withdraw deposit (${title})`, () => withSigner(signer!).withdrawDeposit(id), { amount: params ? `${fmtEth(params.deposit)} ETH` : undefined })}>Withdraw deposit</TxButton>
        </div>
      )}
      <p style={{ marginTop: "1.5rem" }}><button className="link" onClick={() => go({ page: "home" })}>← Back to Home</button></p>
    </>
  );
}

function CommitForm({ id, domain, committed, deposit, minBid }: { id: bigint; domain: string; committed: boolean; deposit?: bigint; minBid?: bigint }) {
  const [bidStr, setBidStr] = useState("");
  const [salt, setSalt] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [done, setDone] = useState(false);
  const { run } = useTx();
  const { signer } = useWallet();
  const { go } = useNav();
  const rate = useRate();

  useEffect(() => { setSalt(null); setAck(false); }, [bidStr, domain]);

  const bid = parseEthAmount(bidStr);
  const below = bid !== null && minBid !== undefined && bid < minBid;
  const sgd = bid !== null && rateIsFresh(rate) ? ((Number(bid) / 1e18) * rate!.sgdPerEth).toFixed(2) : null;

  if (done) return (
    <div className="card" style={{ maxWidth: 620 }}>
      <h3 className="ok">Bid committed</h3>
      <p>Your hidden bid for {domain}.ntu was recorded. Come back during the reveal phase with your domain, bid and salt.</p>
      <p className="warning">Keep your salt safe. If you lose it, you cannot reveal and your deposit is forfeited.</p>
      <button className="primary" onClick={() => go({ page: "home" })}>Back to Home</button>
    </div>
  );
  if (committed) return <div className="card" style={{ maxWidth: 620 }}>You have already committed a bid in this auction. Return during the reveal phase with your domain, bid and salt.</div>;

  const commit = async () => {
    if (bid === null || !salt || deposit === undefined) return;
    rememberLabel(domain);
    const ok = await run(`Bid commitment (${domain}.ntu)`, () => withSigner(signer!).commitBid(id, commitmentOf(domain, bid, salt), { value: deposit }), { amount: `${fmtEth(deposit)} ETH deposit` });
    if (ok) setDone(true);
  };

  return (
    <div style={{ maxWidth: 620 }}>
      <p className="sub">Place a hidden bid before the commit deadline.{deposit !== undefined && ` A fixed deposit of ${fmtEth(deposit)} ETH is sent with your commitment.`}</p>
      <div className="card">
        <label style={{ marginTop: 0 }}>Bid amount (ETH)</label>
        <input value={bidStr} onChange={(e) => setBidStr(e.target.value)} placeholder="0.50" inputMode="decimal" />
        <div className="muted small" style={{ marginTop: ".4rem" }}>
          {bid === null ? "Enter your bid in ETH." : sgd ? `≈ ${sgd} SGD estimate (indicative only)` : "SGD estimate unavailable"}
        </div>
        {below && <div className="err">This bid is below the minimum of {fmtEth(minBid!)} ETH and would be ineligible (your deposit would be refundable).</div>}

        {salt === null ? (
          <button className="primary" disabled={bid === null || bid <= 0n} onClick={() => setSalt(randomSalt())}>Generate random salt</button>
        ) : (
          <>
            <label>Salt / secret backup</label>
            <div className="mono card" style={{ padding: ".7rem 1rem", margin: 0 }}>{salt} <CopyButton text={salt} /></div>
            <dl className="kv">
              <dt>Domain</dt><dd>{domain} <CopyButton text={domain} /></dd>
              <dt>Bid (ETH)</dt><dd>{bidStr.trim()} <CopyButton text={bidStr.trim()} /></dd>
            </dl>
            <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have saved my domain, bid and salt</label>
            <TxButton disabled={!ack} onClick={commit} why="Tick the box to confirm you saved your details.">Commit bid</TxButton>
          </>
        )}
      </div>
      <p className="warning">Never lose the salt: the reveal step must use the exact committed domain, bid and salt. The app does not store it for you.</p>
    </div>
  );
}

function RevealForm({ id, knownDomain, mine, minBid }: { id: bigint; knownDomain?: string; mine: MyState | null | undefined; minBid?: bigint }) {
  const [d, setD] = useState(knownDomain ?? "");
  const [bidStr, setBidStr] = useState("");
  const [salt, setSalt] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const { run } = useTx();
  const { signer } = useWallet();
  const { go } = useNav();
  useEffect(() => { if (knownDomain && !d) setD(knownDomain); /* eslint-disable-next-line */ }, [knownDomain]);

  if (mine && !hasCommitment(mine.commitment)) return <div className="card" style={{ maxWidth: 620 }}>This wallet did not commit a bid in this auction.</div>;
  if (mine?.revealed) return <div className="card" style={{ maxWidth: 620 }}>You have already revealed your bid ({fmtEth(mine.bid)} ETH). {mine.eligible ? "Wait for the settlement phase." : `It was ineligible: ${REASON_LABEL[mine.reason]}.`}</div>;

  const domain = normalise(d);
  const bid = parseEthAmount(bidStr);
  const warn = bid !== null && minBid !== undefined && bid < minBid ? "This reveal will be ineligible (below the minimum bid), but your deposit will be refundable." : null;

  const reveal = async () => {
    setErr(null);
    if (bid === null) return setErr("Enter the bid amount you committed.");
    if (!isSalt(salt)) return setErr("The salt must be the 32-byte hex value (0x + 64 hex characters).");
    if (!mine) return setErr("Connect your wallet first.");
    // Recompute locally and compare before sending anything.
    if (commitmentOf(domain, bid, salt.trim()) !== mine.commitment) return setErr("Details don't match your commitment.");
    await run(`Reveal bid (${domain}.ntu)`, () => withSigner(signer!).revealBid(id, domain, bid, salt.trim()));
  };

  return (
    <div style={{ maxWidth: 620 }}>
      <label>Domain</label>
      <input value={d} onChange={(e) => setD(e.target.value)} placeholder="example1.ntu" />
      <label>Bid amount (ETH)</label>
      <input value={bidStr} onChange={(e) => setBidStr(e.target.value)} placeholder="0.50" inputMode="decimal" />
      <label>Saved salt</label>
      <input value={salt} onChange={(e) => setSalt(e.target.value)} placeholder="0x…" className="mono" />
      {warn && <div className="err">{warn}</div>}
      {err && <div className="err">{err}</div>}
      <TxButton onClick={reveal}>Reveal bid</TxButton>
      <p style={{ marginTop: "1.5rem" }}><button className="link" onClick={() => go({ page: "home" })}>← Back to Home</button></p>
    </div>
  );
}
