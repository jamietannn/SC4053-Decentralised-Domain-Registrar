import { BrowserProvider, getAddress, JsonRpcSigner } from "ethers";
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { CHAIN_ID, NETWORK_NAME, RPC_URL } from "../config";
import { DEMO_ACCOUNT } from "../demo/demoRegistry";
import { describeError } from "../lib/errors";
import { useRegistry } from "./registry";

type WalletState = {
  /** A browser wallet (e.g. MetaMask) is installed. */
  available: boolean;
  account: string | null;
  chainId: number | null;
  wrongNetwork: boolean;
  connecting: boolean;
  error: string | null;
  /** Wallet connected, on the right chain, RPC reachable, contract configured, not demo (SPEC §7). */
  canTransact: boolean;
  connect(): Promise<void>;
  disconnect(): void;
  switchNetwork(): Promise<void>;
  getSigner(): Promise<JsonRpcSigner>;
};

const WalletContext = createContext<WalletState | null>(null);
const DISCONNECTED_KEY = "ntu-names:disconnected";

export function WalletProvider({ children }: { children: ReactNode }) {
  const { demo, rpcOk, configured } = useRegistry();
  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  const [account, setAccount] = useState<string | null>(demo ? DEMO_ACCOUNT : null);
  const [chainId, setChainId] = useState<number | null>(demo ? CHAIN_ID : null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore an existing authorisation silently, and follow account / chain changes.
  useEffect(() => {
    if (demo || !eth) return;
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAccount(accounts?.length ? getAddress(accounts[0]) : null);
    };
    const onChain = (...args: unknown[]) => setChainId(Number(args[0] as string));
    let silenced = false;
    try {
      silenced = localStorage.getItem(DISCONNECTED_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (!silenced) eth.request({ method: "eth_accounts" }).then((a) => onAccounts(a), () => undefined);
    eth.request({ method: "eth_chainId" }).then((c) => onChain(c), () => undefined);
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [demo, eth]);

  const connect = useCallback(async () => {
    if (demo) return;
    if (!eth) {
      setError("MetaMask was not detected. Install it, then reload this page.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      setAccount(accounts.length ? getAddress(accounts[0]) : null);
      setChainId(Number(await eth.request({ method: "eth_chainId" })));
      try {
        localStorage.removeItem(DISCONNECTED_KEY);
      } catch {
        /* ignore */
      }
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setConnecting(false);
    }
  }, [demo, eth]);

  const disconnect = useCallback(() => {
    if (demo) return;
    setAccount(null);
    try {
      localStorage.setItem(DISCONNECTED_KEY, "1");
    } catch {
      /* ignore */
    }
  }, [demo]);

  const switchNetwork = useCallback(async () => {
    if (!eth) return;
    const hexId = "0x" + CHAIN_ID.toString(16);
    setError(null);
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 4902 && CHAIN_ID === 31337) {
        try {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId: hexId, chainName: NETWORK_NAME, rpcUrls: [RPC_URL], nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 } }],
          });
          return;
        } catch (addErr) {
          setError(describeError(addErr).message);
          return;
        }
      }
      setError(describeError(err).message);
    }
  }, [eth]);

  const getSigner = useCallback(async () => {
    if (!eth) throw new Error("No wallet available");
    return new BrowserProvider(eth).getSigner();
  }, [eth]);

  const wrongNetwork = account !== null && chainId !== null && chainId !== CHAIN_ID;
  const canTransact = !demo && configured && rpcOk && account !== null && chainId === CHAIN_ID;

  return (
    <WalletContext.Provider
      value={{ available: demo || !!eth, account, chainId, wrongNetwork, connecting, error, canTransact, connect, disconnect, switchNetwork, getSigner }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
