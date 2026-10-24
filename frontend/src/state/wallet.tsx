import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BrowserProvider, type JsonRpcSigner } from "ethers";
import { CHAIN_ID, DEMO } from "../lib/config";

interface WalletState {
  account: string | null;
  chainId: number | null;
  signer: JsonRpcSigner | null;
  hasWallet: boolean;
  wrongChain: boolean;
  /** true when transactions may be sent: wallet connected, right chain, not demo */
  canSend: boolean;
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;
  error: string | null;
}

const Ctx = createContext<WalletState>(null as unknown as WalletState);
export const useWallet = () => useContext(Ctx);

const eth = () => (window as any).ethereum;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!eth()) return;
    try {
      const provider = new BrowserProvider(eth());
      const accounts: string[] = await provider.send("eth_accounts", []);
      setChainId(Number((await provider.getNetwork()).chainId));
      if (accounts.length) {
        setAccount(accounts[0]);
        setSigner(await provider.getSigner(accounts[0]));
      } else {
        setAccount(null);
        setSigner(null);
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not read wallet state.");
    }
  }, []);

  useEffect(() => {
    if (DEMO) return;
    refresh();
    const e = eth();
    if (!e?.on) return;
    e.on("accountsChanged", refresh);
    e.on("chainChanged", refresh);
    return () => { e.removeListener?.("accountsChanged", refresh); e.removeListener?.("chainChanged", refresh); };
  }, [refresh]);

  const connect = useCallback(async () => {
    setError(null);
    if (!eth()) { setError("MetaMask was not found. Install it to connect a wallet."); return; }
    try {
      await new BrowserProvider(eth()).send("eth_requestAccounts", []);
      await refresh();
    } catch (e: any) {
      setError(e?.code === 4001 ? "Connection request cancelled." : e?.message ?? "Could not connect.");
    }
  }, [refresh]);

  const switchChain = useCallback(async () => {
    try {
      await eth().request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x" + CHAIN_ID.toString(16) }] });
    } catch (e: any) {
      setError(e?.message ?? "Could not switch network.");
    }
  }, []);

  const value = useMemo<WalletState>(() => {
    const wrongChain = chainId !== null && chainId !== CHAIN_ID;
    return {
      account, chainId, signer, hasWallet: !!eth(), wrongChain,
      canSend: !DEMO && !!account && !!signer && !wrongChain, connect, switchChain, error,
    };
  }, [account, chainId, signer, connect, switchChain, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
