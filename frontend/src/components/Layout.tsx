import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { CHAIN_ID, NETWORK_NAME, NETWORK_NAMES } from "../config";
import { shortAddress } from "../lib/format";
import { useRegistry } from "../state/registry";
import { useWallet } from "../state/wallet";
import { TxTray } from "./TxTray";

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/search", label: "Search domains" },
  { to: "/domains", label: "My domains" },
  { to: "/send", label: "Send ETH" },
  { to: "/history", label: "Transactions" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { demo, rpcOk, configured } = useRegistry();
  const wallet = useWallet();
  const walletNetwork = wallet.chainId === null ? null : (NETWORK_NAMES[wallet.chainId] ?? `Chain ${wallet.chainId}`);

  return (
    <div className="app">
      {demo && (
        <div className="demo-banner" role="status">
          DEMO DATA – not on-chain. Transactions are disabled. <a href="?demo=0">Exit demo</a>
        </div>
      )}
      <aside className="sidebar">
        <div className="brand">
          <span aria-hidden>✦</span> NTU Domains
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <p className="sidebar-foot">Decentralized .ntu Domain Registrar</p>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="network-pill" title="Network this app reads from">
            {NETWORK_NAME}
          </span>
          {wallet.account ? (
            <span className="account">
              <span className="mono">{shortAddress(wallet.account)}</span>
              {walletNetwork && <span className={wallet.wrongNetwork ? "wallet-net bad" : "wallet-net"}>wallet: {walletNetwork}</span>}
              {!demo && (
                <button className="btn btn-small btn-ghost" onClick={wallet.disconnect}>
                  Disconnect
                </button>
              )}
            </span>
          ) : (
            <button className="btn btn-primary" onClick={wallet.connect} disabled={wallet.connecting}>
              {wallet.connecting ? "Connecting…" : "Connect MetaMask"}
            </button>
          )}
        </header>

        {!configured && (
          <div className="banner banner-error">
            No NTU Domains contract is configured for chain {CHAIN_ID}. Deploy it (see DEVELOPMENT.md) or set VITE_CONTRACT_ADDRESS.
          </div>
        )}
        {configured && !rpcOk && (
          <div className="banner banner-error" role="alert">
            Network unavailable: the app can't reach the blockchain RPC. Data may be stale and actions are disabled.
          </div>
        )}
        {wallet.wrongNetwork && (
          <div className="banner banner-warn" role="alert">
            Your wallet is on the wrong network. Transactions are disabled until you switch to {NETWORK_NAME}.{" "}
            <button className="btn btn-small btn-primary" onClick={wallet.switchNetwork}>
              Switch to {NETWORK_NAME}
            </button>
          </div>
        )}
        {wallet.error && <div className="banner banner-error">{wallet.error}</div>}

        <main className="content">{children}</main>
      </div>
      <TxTray />
    </div>
  );
}
