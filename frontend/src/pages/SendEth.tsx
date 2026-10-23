import { FormEvent, ReactNode, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, DetailList, Notice, TxLink } from "../components/ui";
import { NETWORK_NAME } from "../config";
import { fqdn } from "../lib/domain";
import { formatDateTime, formatEth, parseEthInput } from "../lib/format";
import { Recipient, resolveRecipient } from "../lib/recipient";
import { useRegistry } from "../state/registry";
import { useTx } from "../state/tx";
import { useWallet } from "../state/wallet";

type Step =
  | { kind: "form" }
  | { kind: "review"; recipient: Recipient; amount: bigint }
  | { kind: "done"; recipient: Recipient; amount: bigint; hash: string; timestamp: number };

export function SendEth() {
  const { registry } = useRegistry();
  const { canTransact } = useWallet();
  const { run } = useTx();
  const [params] = useSearchParams();
  const [to, setTo] = useState(params.get("to") ?? "");
  const [amountInput, setAmountInput] = useState("");
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const proceed = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = parseEthInput(amountInput);
    if (amount === null || amount <= 0n) return setError("Enter an amount of ETH greater than 0.");
    setBusy(true);
    try {
      const result = await resolveRecipient(to, (d) => registry.resolve(d));
      if (!result.ok) return setError(result.error);
      setStep({ kind: "review", recipient: result.recipient, amount });
    } catch {
      setError("Couldn't resolve the name. Is the network reachable?");
    } finally {
      setBusy(false);
    }
  };

  const send = async (recipient: Recipient, amount: bigint) => {
    setBusy(true);
    const label = recipient.kind === "domain" ? fqdn(recipient.domain) : recipient.address;
    const result = await run(`Send ${formatEth(amount)} to ${label}`, (_, signer) =>
      signer.sendTransaction({ to: recipient.address, value: amount }),
    );
    setBusy(false);
    if (result) setStep({ kind: "done", recipient, amount, hash: result.hash, timestamp: result.timestamp });
  };

  const reviewRows = (recipient: Recipient, amount: bigint): Array<[string, ReactNode]> => [
    ["Recipient", recipient.kind === "domain" ? fqdn(recipient.domain) : "Direct address"],
    ["Resolved address", <span className="mono break">{recipient.address}</span>],
    ["Amount", formatEth(amount)],
    ["Network", NETWORK_NAME],
    ["Fee", "Shown by your wallet before you confirm"],
  ];

  if (step.kind === "done")
    return (
      <div className="stack">
        <h1>Confirm transaction</h1>
        <Card title="Transaction confirmed!">
          <DetailList
            rows={[...reviewRows(step.recipient, step.amount).slice(0, 4), ["Time", formatDateTime(step.timestamp)], ["Transaction", <TxLink hash={step.hash} />]]}
          />
          <Link className="btn btn-primary" to="/">
            Back to Home
          </Link>
        </Card>
      </div>
    );

  if (step.kind === "review")
    return (
      <div className="stack">
        <h1>Confirm transaction</h1>
        <Card title="Review transfer">
          <DetailList rows={reviewRows(step.recipient, step.amount)} />
          <Notice tone="warn">Check the resolved address. ETH sent to the wrong address cannot be recovered.</Notice>
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setStep({ kind: "form" })} disabled={busy}>
              Back
            </button>
            <button className="btn btn-primary" onClick={() => send(step.recipient, step.amount)} disabled={!canTransact || busy}>
              {busy ? "Waiting for wallet…" : "Continue to MetaMask"}
            </button>
          </div>
          {!canTransact && <p className="hint">Connect your wallet on {NETWORK_NAME} to send.</p>}
        </Card>
      </div>
    );

  return (
    <div className="stack">
      <h1>Send ETH to a .ntu name</h1>
      <p className="muted">Send ETH to a registered name or a direct address.</p>
      <Card>
        <form className="stack-tight" onSubmit={proceed}>
          <label className="field">
            <span>Recipient name or address</span>
            <input placeholder="e.g. javier.ntu or 0x1234…" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="field">
            <span>Amount (ETH)</span>
            <input inputMode="decimal" placeholder="0.01" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} />
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Resolving…" : "Proceed"}
          </button>
        </form>
      </Card>
    </div>
  );
}
