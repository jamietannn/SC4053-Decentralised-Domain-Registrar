import { useEffect, useState } from "react";
import { Phase, PHASE_LABEL, loadAuction, readContract, withSigner, type AuctionInfo } from "../lib/chain";
import { DEMO } from "../lib/config";
import { demoSearch } from "../lib/demo";
import { nameHash, normalise, validateDomain } from "../lib/domain";
import { ZERO, countdown, shortAddr } from "../lib/format";
import { rememberLabel } from "../lib/labels";
import { Badge, TxButton } from "../components";
import { useNow } from "../state/hooks";
import { useNav } from "../state/nav";
import { useTx } from "../state/tx";
import { useWallet } from "../state/wallet";

type Result =
  | { kind: "invalid"; domain: string; msg: string }
  | { kind: "available"; domain: string }
  | { kind: "auction"; domain: string; info: AuctionInfo }
  | { kind: "registered"; domain: string; owner: string };

async function lookup(raw: string): Promise<Result> {
  const domain = normalise(raw);
  const bad = validateDomain(domain);
  if (bad) return { kind: "invalid", domain, msg: bad };
  if (DEMO) {
    const d = demoSearch[domain] ?? { kind: "available" as const };
    if (d.kind === "registered") return { kind: "registered", domain, owner: d.owner };
    if (d.kind === "auction") {
      const { demoAuctions } = await import("../lib/demo");
      const found = demoAuctions().find((x) => x.auction.id === BigInt(d.id))!;
      return { kind: "auction", domain, info: { ...found.auction, phase: d.phase } };
    }
    return { kind: "available", domain };
  }
  rememberLabel(domain);
  const owner: string = await readContract.ownerOf(domain);
  if (owner !== ZERO) return { kind: "registered", domain, owner };
  const id: bigint = await readContract.activeAuctionOf(nameHash(domain));
  if (id === 0n) return { kind: "available", domain };
  return { kind: "auction", domain, info: await loadAuction(id) };
}

const BADGE: Record<number, string> = { [Phase.Commit]: "commit", [Phase.Reveal]: "reveal", [Phase.Settlement]: "settlement", [Phase.Closed]: "closed" };

export default function Search({ initial }: { initial?: string }) {
  const [q, setQ] = useState(initial ?? "");
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const { go } = useNav();
  const { run } = useTx();
  const { signer } = useWallet();
  const now = useNow();

  const search = async (value = q) => {
    setErr(null); setOpen(false);
    if (!value.trim()) return;
    setBusy(true);
    try { setRes(await lookup(value)); } catch { setErr("Could not reach the network. Try again."); setRes(null); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (initial) search(initial); /* eslint-disable-next-line */ }, []);

  const start = async (domain: string) => {
    const ok = await run(`Start auction (${domain}.ntu)`, () => withSigner(signer!).startAuction(nameHash(domain)));
    if (ok) search(domain);
  };

  return (
    <>
      <h1>Search .ntu domains</h1>
      <p className="sub">Search a name to check availability or current auction state.</p>
      <form className="search-bar" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="example" aria-label="Domain name" />
        <button className="primary" disabled={busy}>{busy ? "…" : "Search"}</button>
      </form>
      {err && <div className="err">{err}</div>}

      {res && (
        <div className="card" style={{ marginTop: "1.25rem" }}>
          <div className="row">
            <strong className="grow">{res.domain}.ntu</strong>
            {res.kind === "invalid" && <Badge kind="invalid">Invalid</Badge>}
            {res.kind === "available" && <Badge kind="available">Available</Badge>}
            {res.kind === "registered" && <Badge kind="registered">Registered</Badge>}
            {res.kind === "auction" && <Badge kind={BADGE[res.info.phase] ?? "closed"}>{res.info.phase === Phase.Closed ? "Closed – no winner" : PHASE_LABEL[res.info.phase]}</Badge>}
            <span className="grow" style={{ textAlign: "right" }}>
              {res.kind === "available" && <TxButton className="secondary" onClick={() => start(res.domain)}>Start auction</TxButton>}
              {res.kind === "registered" && <button className="link" onClick={() => setOpen(!open)}>View details</button>}
              {res.kind === "auction" && res.info.phase === Phase.Commit && <button className="link" onClick={() => go({ page: "auction", id: res.info.id, domain: res.domain })}>Commit bid</button>}
              {res.kind === "auction" && res.info.phase === Phase.Reveal && <button className="link" onClick={() => go({ page: "auction", id: res.info.id, domain: res.domain })}>Reveal bid</button>}
              {res.kind === "auction" && res.info.phase === Phase.Settlement && <button className="link" onClick={() => go({ page: "auction", id: res.info.id, domain: res.domain })}>Settle payment</button>}
              {res.kind === "auction" && res.info.phase === Phase.Closed && (
                <>
                  <button className="link" onClick={() => go({ page: "auction", id: res.info.id, domain: res.domain })}>Finalise</button>{" · "}
                  <TxButton className="secondary" onClick={() => start(res.domain)}>Start new auction</TxButton>
                </>
              )}
            </span>
          </div>
          {res.kind === "invalid" && <div className="err">{res.msg}</div>}
          {res.kind === "auction" && res.info.phase === Phase.Commit && <div className="muted small">Commit deadline in {countdown(res.info.commitDeadline - now / 1000)}</div>}
          {res.kind === "auction" && res.info.phase === Phase.Reveal && <div className="muted small">Reveal deadline in {countdown(res.info.revealDeadline - now / 1000)}</div>}
          {res.kind === "registered" && open && (
            <dl className="kv">
              <dt>Owner</dt><dd className="mono">{res.owner}</dd>
              <dt>Resolves to</dt><dd className="mono">{res.owner}</dd>
              <dt></dt><dd><button className="link" onClick={() => go({ page: "send", to: `${res.domain}.ntu` })}>Send ETH to {res.domain}.ntu ({shortAddr(res.owner)})</button></dd>
            </dl>
          )}
        </div>
      )}
    </>
  );
}
