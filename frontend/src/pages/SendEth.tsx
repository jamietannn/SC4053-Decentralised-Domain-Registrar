import { useState } from "react";
import { formatEther, getAddress, isAddress } from "ethers";
import { readContract } from "../lib/chain";
import { CHAIN_ID, DEMO, chainName } from "../lib/config";
import { normalise, parseEthAmount, validateDomain } from "../lib/domain";
import { ZERO, fmtEth } from "../lib/format";
import { DEMO_ACCOUNT } from "../lib/demo";
import { TxButton } from "../components";
import { useNav } from "../state/nav";
import { useTx } from "../state/tx";
import { useWallet } from "../state/wallet";

interface Review { input: string; domain?: string; address: string; amount: bigint; fee?: string }

export default function SendEth({ initial }: { initial?: string }) {
  const [to, setTo] = useState(initial ?? "");
  const [amt, setAmt] = useState("0.01");
  const [err, setErr] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const { signer } = useWallet();
  const { run, txs } = useTx();
  const { go } = useNav();

  const proceed = async () => {
    setErr(null);
    const amount = parseEthAmount(amt);
    if (amount === null || amount <= 0n) return setErr("Enter an amount greater than 0.");
    const input = to.trim();
    if (!input) return setErr("Enter a .ntu name or an address.");
    let address: string; let domain: string | undefined;
    if (isAddress(input)) address = getAddress(input);
    else {
      domain = normalise(input);
      const bad = validateDomain(domain);
      if (bad) return setErr(bad);
      try { address = DEMO ? DEMO_ACCOUNT : await readContract.resolve(domain); } catch { return setErr("Could not reach the network to resolve this name."); }
      if (address === ZERO) return setErr(`${domain}.ntu is not registered, so it can't be paid.`);
    }
    let fee: string | undefined;
    try {
      if (signer) {
        const [gas, data] = await Promise.all([signer.estimateGas({ to: address, value: amount }), signer.provider!.getFeeData()]);
        const price = data.maxFeePerGas ?? data.gasPrice;
        if (price) fee = `${formatEther(gas * price)} ETH`;
      }
    } catch { /* fee estimate is optional */ }
    setReview({ input, domain, address, amount, fee });
  };

  const send = async () => {
    if (!review || !signer) return;
    const label = `ETH transfer to ${review.domain ? review.domain + ".ntu" : review.address.slice(0, 8) + "…"}`;
    const ok = await run(label, () => signer.sendTransaction({ to: review.address, value: review.amount }), { amount: `-${fmtEth(review.amount)} ETH` });
    if (ok) setHash("sent");
  };

  if (hash !== null && review) {
    const t = txs.find((x) => x.status === "confirmed" && x.label.startsWith("ETH transfer"));
    return (
      <>
        <h1>Transfer sent</h1>
        <div className="card win" style={{ maxWidth: 620 }}>
          <p className="ok">{fmtEth(review.amount)} ETH sent to {review.domain ? `${review.domain}.ntu` : review.address}.</p>
          {t?.hash && <p className="mono small">Transaction hash: {t.hash}</p>}
          <button className="primary" onClick={() => go({ page: "home" })}>Back to Home</button>
        </div>
      </>
    );
  }

  if (review) return (
    <>
      <h1>Review transfer</h1>
      <div className="card" style={{ maxWidth: 620 }}>
        <dl className="kv">
          <dt>Recipient</dt><dd>{review.domain ? `${review.domain}.ntu` : "Address"}</dd>
          <dt>Resolved address</dt><dd className="mono">{review.address}</dd>
          <dt>Amount</dt><dd>{fmtEth(review.amount)} ETH</dd>
          <dt>Network</dt><dd>{chainName(CHAIN_ID)}</dd>
          <dt>Est. network fee</dt><dd>{review.fee ?? "Shown by your wallet"}</dd>
        </dl>
        <p className="muted small">This is a direct wallet transfer. Check the address above before continuing.</p>
        <div style={{ display: "flex", gap: "1rem" }}>
          <button className="secondary" style={{ marginTop: "1rem" }} onClick={() => setReview(null)}>Back</button>
          <TxButton onClick={send}>Continue to MetaMask</TxButton>
        </div>
      </div>
    </>
  );

  return (
    <>
      <h1>Send ETH to a .ntu name</h1>
      <p className="sub">Send ETH to a registered name or a direct address.</p>
      <div style={{ maxWidth: 620 }}>
        <label>Recipient name or address</label>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. javier.ntu or 0x1234…" />
        <label>Amount (ETH)</label>
        <input value={amt} onChange={(e) => setAmt(e.target.value)} />
        {err && <div className="err">{err}</div>}
        <button className="primary" onClick={proceed}>Proceed</button>
      </div>
    </>
  );
}
