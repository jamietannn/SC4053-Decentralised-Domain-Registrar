import deployments from "./generated/deployments.json";

type Deployment = { address: string; deployBlock: number };

const env = import.meta.env;

export const CHAIN_ID = Number(env.VITE_CHAIN_ID || 31337);
export const RPC_URL: string = env.VITE_RPC_URL || "http://127.0.0.1:8545";

const deployment = (deployments as Record<string, Deployment | undefined>)[String(CHAIN_ID)];
export const CONTRACT_ADDRESS: string = env.VITE_CONTRACT_ADDRESS || deployment?.address || "";
export const DEPLOY_BLOCK = Number(env.VITE_DEPLOY_BLOCK || deployment?.deployBlock || 0);

export const NETWORK_NAMES: Record<number, string> = { 11155111: "Sepolia", 31337: "Hardhat local" };
export const NETWORK_NAME = NETWORK_NAMES[CHAIN_ID] ?? `Chain ${CHAIN_ID}`;
export const EXPLORER_TX_URL = CHAIN_ID === 11155111 ? "https://sepolia.etherscan.io/tx/" : null;

/** Demo mode: VITE_DEMO=1, or ?demo=1 in the URL (remembered for the browser tab; ?demo=0 turns it off). */
function detectDemoMode(): boolean {
  if (env.VITE_DEMO === "1") return true;
  if (typeof window === "undefined") return false;
  try {
    const param = new URLSearchParams(window.location.search).get("demo");
    if (param === "1") sessionStorage.setItem("ntu-demo", "1");
    if (param === "0") sessionStorage.removeItem("ntu-demo");
    return sessionStorage.getItem("ntu-demo") === "1";
  } catch {
    return new URLSearchParams(window.location.search).get("demo") === "1";
  }
}

export const DEMO_MODE = detectDemoMode();
