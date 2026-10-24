import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Optional Sepolia deployment: set SEPOLIA_RPC_URL and DEPLOYER_PRIVATE_KEY in the environment.
const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

// `npm run node` sets LOCAL_INTERVAL_MINING so the local chain mines a block every second and its clock follows
// real time. Without it the chain clock only advances on transactions, which makes the UI's phase display stale.
// Tests leave it unset so they keep full control of time.
const intervalMining = process.env.LOCAL_INTERVAL_MINING === "1";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    ...(intervalMining ? { hardhat: { mining: { auto: true, interval: 1000 } } } : {}),
    ...(SEPOLIA_RPC_URL && DEPLOYER_PRIVATE_KEY
      ? { sepolia: { url: SEPOLIA_RPC_URL, accounts: [DEPLOYER_PRIVATE_KEY], chainId: 11155111 } }
      : {}),
  },
};

export default config;
