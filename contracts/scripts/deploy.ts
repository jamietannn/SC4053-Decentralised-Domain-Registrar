import fs from "fs";
import path from "path";
import { artifacts, ethers, network } from "hardhat";

// Deploy values from SPEC.md: 180 s per phase, 0.005 ETH deposit and minimum bid.
const COMMIT_SECONDS = 180;
const REVEAL_SECONDS = 180;
const SETTLEMENT_SECONDS = 180;
const DEPOSIT = ethers.parseEther("0.005");
const MIN_BID = ethers.parseEther("0.005");

const GENERATED_DIR = path.join(__dirname, "../../frontend/src/generated");

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  if (!ethers.isAddress(treasury)) throw new Error(`TREASURY_ADDRESS is not an address: ${treasury}`);

  const registrar = await ethers.deployContract("NtuNames", [
    COMMIT_SECONDS,
    REVEAL_SECONDS,
    SETTLEMENT_SECONDS,
    DEPOSIT,
    MIN_BID,
    treasury,
  ]);
  await registrar.waitForDeployment();
  const receipt = await registrar.deploymentTransaction()!.wait();
  const address = await registrar.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`NtuNames deployed to ${address} on ${network.name} (chain ${chainId})`);
  console.log(`Treasury: ${treasury}`);

  // Hand the ABI and address to the frontend.
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  const { abi } = await artifacts.readArtifact("NtuNames");
  fs.writeFileSync(path.join(GENERATED_DIR, "NtuNames.abi.json"), JSON.stringify(abi, null, 2) + "\n");

  const deploymentsFile = path.join(GENERATED_DIR, "deployments.json");
  const deployments = fs.existsSync(deploymentsFile) ? JSON.parse(fs.readFileSync(deploymentsFile, "utf8")) : {};
  deployments[chainId] = { address, deployBlock: receipt!.blockNumber, deployedAt: new Date().toISOString() };
  fs.writeFileSync(deploymentsFile, JSON.stringify(deployments, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), deploymentsFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
