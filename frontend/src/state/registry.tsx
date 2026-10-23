import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { CONTRACT_ADDRESS, DEMO_MODE } from "../config";
import { createChainRegistry } from "../lib/chainRegistry";
import { Registry } from "../lib/types";
import { createDemoRegistry } from "../demo/demoRegistry";

type RegistryState = {
  registry: Registry;
  demo: boolean;
  /** False when no contract address is configured for the target chain. */
  configured: boolean;
  /** False when the configured RPC is unreachable (SPEC §6). */
  rpcOk: boolean;
};

const RegistryContext = createContext<RegistryState | null>(null);

const HEALTH_POLL_MS = 15_000;

export function RegistryProvider({ children }: { children: ReactNode }) {
  const configured = DEMO_MODE || CONTRACT_ADDRESS !== "";
  const registry = useMemo(() => (DEMO_MODE ? createDemoRegistry() : createChainRegistry()), []);
  const [rpcOk, setRpcOk] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      registry.blockNumber().then(
        () => !cancelled && setRpcOk(true),
        () => !cancelled && setRpcOk(false),
      );
    check();
    const t = setInterval(check, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [registry]);

  return (
    <RegistryContext.Provider value={{ registry, demo: DEMO_MODE, configured, rpcOk }}>
      {children}
    </RegistryContext.Provider>
  );
}

export function useRegistry(): RegistryState {
  const ctx = useContext(RegistryContext);
  if (!ctx) throw new Error("useRegistry must be used inside RegistryProvider");
  return ctx;
}
