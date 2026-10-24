const env = import.meta.env;

export const RPC_URL: string = env.VITE_RPC_URL || "http://127.0.0.1:8545";
export const CONTRACT_ADDRESS: string = env.VITE_CONTRACT_ADDRESS || "";
export const CHAIN_ID = Number(env.VITE_CHAIN_ID || 31337);
export const DEPLOY_BLOCK = Number(env.VITE_DEPLOY_BLOCK || 0);
export const DEMO: boolean = env.VITE_DEMO === "1" || new URLSearchParams(window.location.search).get("demo") === "1";

export const CHAIN_NAMES: Record<number, string> = { 1: "Ethereum Mainnet", 11155111: "Sepolia", 31337: "Hardhat (local)" };
export const chainName = (id: number) => CHAIN_NAMES[id] ?? `Chain ${id}`;
