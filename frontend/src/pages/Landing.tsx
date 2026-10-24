import { useWallet } from "../state/wallet";

export default function Landing({ onBrowse, onConnect }: { onBrowse: () => void; onConnect: () => void }) {
  const { error } = useWallet();
  return (
    <div className="landing">
      <div className="muted small" style={{ textAlign: "left" }}>NTU Names · Decentralized .ntu Domain Registrar</div>
      <h1>Own your identity on-chain.</h1>
      <p>Register, manage and resolve .ntu names using a compatible Ethereum wallet.</p>
      <button className="primary" onClick={onConnect}>Connect MetaMask 🦊</button>
      {error && <div className="err">{error}</div>}
      <div style={{ marginTop: "1rem" }}><button className="link small" onClick={onBrowse}>Browse without a wallet (read-only)</button></div>
      <p className="warning" style={{ fontSize: "1rem", margin: "2rem 0 0" }}>Never enter your seed phrase or private key.</p>
    </div>
  );
}
