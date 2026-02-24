const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("Deploying ARCPredictX to Arc Testnet...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "USDC\n");

  const Factory = await hre.ethers.getContractFactory("ARCPredictX");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("✅ ARCPredictX deployed to:", address);
  console.log("Admin:", deployer.address);

  // Write deployment info to frontend
  const artifact = await hre.artifacts.readArtifact("ARCPredictX");
  const deployment = { address, abi: artifact.abi, deployer: deployer.address };

  const outPath = path.join(__dirname, "..", "frontend", "src", "deployment.json");
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log("\n📝 Deployment info written to frontend/src/deployment.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
