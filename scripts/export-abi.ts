import { artifacts } from "hardhat";
import { writeFileSync } from "fs";

async function main() {
  const { abi } = await artifacts.readArtifact("NtuNames");
  writeFileSync("frontend/src/lib/abi.json", JSON.stringify(abi, null, 2));
  console.log(`Wrote ${abi.length} ABI entries to frontend/src/lib/abi.json`);
}
main();
