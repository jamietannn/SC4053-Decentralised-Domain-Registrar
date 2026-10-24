import { ethers, network } from "hardhat";
import { writeFileSync } from "fs";

// Deploys NtuNames with the SPEC.md defaults (180 s phases, 0.005 ETH deposit/min bid)
// and writes frontend/.env.local so the dev server picks up the address.
async function main() {
  const [deployer, defaultTreasury] = await ethers.getSigners();
  const treasury = process.env.TREASURY ?? defaultTreasury?.address ?? deployer.address;
  const secs = Number(process.env.PHASE_SECONDS ?? 180);
  const D = ethers.parseEther("0.005");
  const ntu = await (await ethers.getContractFactory("NtuNames")).deploy(secs, secs, secs, D, D, treasury);
  const receipt = await ntu.deploymentTransaction()!.wait();
  const address = await ntu.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const rpc = network.name === "localhost" ? "http://127.0.0.1:8545" : (network.config as any).url ?? "";
  writeFileSync(
    "frontend/.env.local",
    `VITE_CONTRACT_ADDRESS=${address}\nVITE_CHAIN_ID=${chainId}\nVITE_DEPLOY_BLOCK=${receipt!.blockNumber}\nVITE_RPC_URL=${rpc}\n`,
  );
  console.log(`NtuNames deployed to ${address} on chain ${chainId} (treasury ${treasury}, ${secs}s phases)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
