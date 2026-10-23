import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AuctionPage } from "./pages/Auction";
import { History } from "./pages/History";
import { Home } from "./pages/Home";
import { MyDomains } from "./pages/MyDomains";
import { Search } from "./pages/Search";
import { SendEth } from "./pages/SendEth";
import { RegistryProvider } from "./state/registry";
import { SgdRateProvider } from "./state/sgdRate";
import { TxProvider } from "./state/tx";
import { WalletProvider } from "./state/wallet";

export function App() {
  return (
    <RegistryProvider>
      <SgdRateProvider>
        <WalletProvider>
          <TxProvider>
            <BrowserRouter>
              <Layout>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/search" element={<Search />} />
                  <Route path="/auction/:id" element={<AuctionPage />} />
                  <Route path="/domains" element={<MyDomains />} />
                  <Route path="/send" element={<SendEth />} />
                  <Route path="/history" element={<History />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Layout>
            </BrowserRouter>
          </TxProvider>
        </WalletProvider>
      </SgdRateProvider>
    </RegistryProvider>
  );
}
