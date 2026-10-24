import { Phase, PHASE_LABEL, withSigner } from "../lib/chain";
import { fmtDate, fmtEth, shortAddr } from "../lib/format";
import { TxButton } from "../components";
import { useMyAuctions, useMyNames } from "../state/hooks";
import { useNav } from "../state/nav";
import { useAccount } from "../state/params";
import { useTx } from "../state/tx";
import { useWallet } from "../state/wallet";
import { auctionTitle } from "./Dashboard";

export default function MyDomains() {
  const acct = useAccount();
  const names = useMyNames(acct);
  const auctions = useMyAuctions(acct);
  const { go } = useNav();
  const { run } = useTx();
  const { signer } = useWallet();

  const pending = (auctions.data ?? []).filter((x) => [Phase.Commit, Phase.Reveal, Phase.Settlement].includes(x.auction.phase));
  const verb = { [Phase.Commit]: "Commit bid", [Phase.Reveal]: "Reveal bid", [Phase.Settlement]: "Settle payment" } as Record<number, string>;

  return (
    <>
      <h1>My domains &amp; primary name</h1>
      <p className="sub">Manage registered names.</p>
      {!acct && <div className="muted">Connect a wallet to see your domains.</div>}
      {names.error !== undefined && <div className="err">Could not load your domains from the network.</div>}
      <table>
        <thead><tr><th>Domain name</th><th>Status</th><th>Address</th><th>Bid amount</th><th>Date resolved</th><th>Action</th></tr></thead>
        <tbody>
          {names.data?.map((n) => (
            <tr key={n.name}>
              <td>{n.name}.ntu</td>
              <td className={n.primary ? "status-primary" : "muted"}>{n.primary ? "Primary" : "Registered"}</td>
              <td className="mono">{shortAddr(n.resolved)}</td>
              <td>{n.price !== undefined ? `${fmtEth(n.price)} ETH` : "—"}</td>
              <td>{n.date ? fmtDate(n.date) : "—"}</td>
              <td>{!n.primary && (
                <TxButton className="link" onClick={() => run(`Set primary (${n.name}.ntu)`, () => withSigner(signer!).setPrimaryName(n.name))}>Set primary</TxButton>
              )}</td>
            </tr>
          ))}
          {pending.map((x) => (
            <tr key={String(x.auction.id)}>
              <td>{auctionTitle(x.label, x.auction.id)}</td>
              <td className={x.auction.phase === Phase.Settlement ? "status-settlement" : "status-reveal"}>{PHASE_LABEL[x.auction.phase]}</td>
              <td>—</td><td>—</td><td>—</td>
              <td><button className="link" onClick={() => go({ page: "auction", id: x.auction.id, domain: x.label })}>{verb[x.auction.phase]}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {acct && names.data?.length === 0 && pending.length === 0 && <div className="muted">Nothing yet. Search for a name to start an auction.</div>}
    </>
  );
}
