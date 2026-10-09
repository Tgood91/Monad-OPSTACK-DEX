// BushidoVirtueRegistry deployment script for Base.
// Prompts for everything — no hardcoded secrets.
//
// Usage:
//   cd dex-app/server && npm install ethers solc
//   node ../../deploy-bushido.js
//
// What it does:
//   1. Compiles BushidoVirtueRegistry_v2_multisig.sol (or v2)
//   2. Deploys to Base from your EOA
//   3. Proposes ownership transfer to your Safe (Safe must accept via acceptOwnership)
//   4. Prints the deployed address for BUSHIDO_REGISTRY env

import { ethers } from "ethers";
import solc from "solc";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, secret = false) =>
  new Promise((resolve) => {
    if (!secret) return rl.question(q, resolve);
    // Hide secret input
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    let val = "";
    process.stdout.write(q);
    stdin.on("data", (ch) => {
      const c = ch.toString();
      if (c === "\n" || c === "\r") {
        stdin.setRawMode(false);
        stdin.pause();
        process.stdout.write("\n");
        resolve(val);
      } else if (c === "\u0003") {
        process.exit(1);
      } else if (c === "\u007f") {
        val = val.slice(0, -1);
      } else {
        val += c;
      }
    });
  });

const CONTRACTS = {
  multisig: {
    file: "BushidoVirtueRegistry_v2_multisig.sol",
    name: "BushidoVirtueRegistryMultisig",
    desc: "Multisig-hardened (Ownable2Step) — RECOMMENDED",
  },
  v2: {
    file: "BushidoVirtueRegistry_v2.sol",
    name: "BushidoVirtueRegistry",
    desc: "Standard v2 (Ownable)",
  },
};

async function main() {
  console.log("\n=== BushidoVirtueRegistry Deployment (Base) ===\n");

  // 1. Choose contract
  console.log("Which contract?");
  for (const [k, c] of Object.entries(CONTRACTS)) console.log(`  ${k}: ${c.desc}`);
  const choice = (await ask("Choice [multisig]: ")).trim().toLowerCase() || "multisig";
  const sel = CONTRACTS[choice];
  if (!sel) throw new Error("invalid choice");

  // 2. Locate source file
  const guesses = [
    `~/workspace/user/files/${sel.file}`.replace("~", process.env.HOME),
    `./${sel.file}`,
    `../${sel.file}`,
  ];
  let srcPath = null;
  for (const g of guesses) if (fs.existsSync(g)) { srcPath = g; break; }
  if (!srcPath) srcPath = await ask(`Path to ${sel.file}: `);
  const source = fs.readFileSync(srcPath.trim(), "utf8");

  // 3. Private key + Safe address
  const pk = await ask("Deployer private key (0x…): ", true);
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk.trim())) throw new Error("bad private key format");
  const safe = (await ask("Your Safe address (2/3 multisig): ")).trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(safe)) throw new Error("bad Safe address");

  const rpc = (await ask("Base RPC [https://mainnet.base.org]: ")).trim() || "https://mainnet.base.org";

  // 4. Compile
  console.log("\nCompiling…");
  const input = {
    language: "Solidity",
    sources: { [sel.file]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } },
    },
  };
  // Resolve OpenZeppelin imports from node_modules if present
  const findImports = (p) => {
    for (const base of ["./node_modules", "../node_modules", "./server/node_modules"]) {
      const full = path.join(base, p);
      if (fs.existsSync(full)) return { contents: fs.readFileSync(full, "utf8") };
    }
    return { error: "not found: " + p };
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  if (out.errors?.some((e) => e.severity === "error")) {
    for (const e of out.errors.filter((e) => e.severity === "error")) console.error(e.formattedMessage);
    throw new Error("compilation failed");
  }
  const contract = out.contracts[sel.file][sel.name];
  const abi = contract.abi;
  const bytecode = "0x" + contract.evm.bytecode.object;
  console.log(`Compiled OK — bytecode ${(bytecode.length - 2) / 2} bytes`);

  // 5. Deploy
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk.trim(), provider);
  console.log(`\nDeployer: ${wallet.address}`);
  const bal = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(bal)} ETH`);
  if (bal === 0n) throw new Error("deployer has no ETH for gas");

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  console.log("\nDeploying… (confirm in your head — this spends real ETH)");
  const confirm = (await ask("Deploy? [y/N]: ")).trim().toLowerCase();
  if (confirm !== "y") { console.log("Aborted."); process.exit(0); }

  const deployed = await factory.deploy();
  console.log(`Tx sent: ${deployed.deploymentTransaction().hash}`);
  await deployed.waitForDeployment();
  const addr = await deployed.getAddress();
  console.log(`\n✓ Deployed at: ${addr}`);
  console.log(`  Basescan: https://basescan.org/address/${addr}`);

  // 6. Propose ownership to Safe (Ownable2Step: Safe must accept)
  console.log("\nProposing ownership transfer to Safe…");
  const tx = await deployed.transferOwnership(safe);
  console.log(`transferOwnership tx: ${tx.hash}`);
  await tx.wait();
  console.log(`\n✓ Ownership proposed to ${safe}`);
  console.log(`  IMPORTANT: From your Safe, call acceptOwnership() on ${addr}`);
  console.log(`  Then call setVirtueController(<backend-or-safe>) as needed.`);

  console.log(`\n=== Done ===`);
  console.log(`Set BUSHIDO_REGISTRY=${addr} in your backend env.`);
  rl.close();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
