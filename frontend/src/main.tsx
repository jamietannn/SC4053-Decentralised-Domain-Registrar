import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { WalletProvider } from "./state/wallet";
import { TxProvider } from "./state/tx";
import { NavProvider } from "./state/nav";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WalletProvider><TxProvider><NavProvider><App /></NavProvider></TxProvider></WalletProvider>
  </React.StrictMode>,
);
