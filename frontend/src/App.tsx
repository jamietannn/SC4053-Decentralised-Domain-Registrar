import { useState } from "react";
import { Banners, TxToast, WalletChip } from "./components";
import { useNav, type Route } from "./state/nav";
import { useNetworkDown } from "./state/hooks";
import { useAccount } from "./state/params";
import { useWallet } from "./state/wallet";
import { DEMO } from "./lib/config";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Search from "./pages/Search";
import MyDomains from "./pages/MyDomains";
import SendEth from "./pages/SendEth";
import History from "./pages/History";
import Auction from "./pages/Auction";

const NAV: { label: string; page: Route["page"] }[] = [
  { label: "Home", page: "home" }, { label: "Search domains", page: "search" }, { label: "My domains", page: "domains" },
  { label: "Send ETH", page: "send" }, { label: "Transactions", page: "tx" },
];

export default function App() {
  const { route, go } = useNav();
  const account = useAccount();
  const { connect } = useWallet();
  const networkDown = useNetworkDown();
  const [browsing, setBrowsing] = useState(false);

  if (!account && !DEMO && !browsing) return (
    <>
      <Banners networkDown={networkDown} />
      <Landing onBrowse={() => setBrowsing(true)} onConnect={connect} />
    </>
  );

  const active = route.page === "auction" ? "search" : route.page;
  return (
    <>
      <Banners networkDown={networkDown} />
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">✦ NTU Names</div>
          <nav className="nav">
            {NAV.map((n) => (
              <button key={n.page} className={active === n.page ? "active" : ""} onClick={() => go({ page: n.page } as Route)}>{n.label}</button>
            ))}
          </nav>
          <div className="foot"><WalletChip /></div>
        </aside>
        <main>
          {route.page === "home" && <Dashboard />}
          {route.page === "search" && <Search initial={route.query} />}
          {route.page === "domains" && <MyDomains />}
          {route.page === "send" && <SendEth initial={route.to} />}
          {route.page === "tx" && <History />}
          {route.page === "auction" && <Auction id={route.id} knownDomain={route.domain} />}
        </main>
      </div>
      <TxToast />
    </>
  );
}
