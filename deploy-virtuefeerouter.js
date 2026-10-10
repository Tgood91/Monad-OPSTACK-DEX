// VirtueFeeRouter deployment script for Base.
// Prompts for everything — no hardcoded secrets.
//
// Usage:
//   cd dex-app/server && npm install ethers solc @openzeppelin/contracts
//   node ../../deploy-virtuefeerouter.js
//
// What it does:
//   1. Compiles VirtueFeeRouter.sol (OpenZeppelin AccessControl)
//   2. Deploys to Base from your EOA with (admin, recorder) constructor args
//   3. Prints the deployed address + Basescan link
//
// Roles: admin gets DEFAULT_ADMIN_ROLE + GOVERNOR_ROLE; recorder gets RECORDER_ROLE.
// Tip: use your Safe as admin. Recorder can be the Safe too, or a backend EOA
// that will call recordVirtueAudit.

import { ethers } from "ethers";
import solc from "solc";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, secret = false) =>
  new Promise((resolve) => {
    if (!secret) return rl.question(q, resolve);
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

const FILE = "VirtueFeeRouter.sol";
const CONTRACT = "VirtueFeeRouter";

async function main() {
  console.log("\n=== VirtueFeeRouter Deployment (Base) ===\n");

  // 1. Locate source
  const guesses = [
    `${process.env.HOME}/workspace/user/files/${FILE}`,
    `./${FILE}`,
    `../${FILE}`,
  ];
  let srcPath = null;
  for (const g of guesses) if (fs.existsSync(g)) { srcPath = g; break; }
  if (!srcPath) srcPath = await ask(`Path to ${FILE}: `);
  const source = fs.readFileSync(srcPath.trim(), "utf8");

  // 2. Private key, admin, recorder
  const pk = await ask("Deployer private key (0x…): ", true);
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk.trim())) throw new Error("bad private key format");
  const admin = (await ask("Admin address (your Safe — gets DEFAULT_ADMIN + GOVERNOR roles): ")).trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(admin)) throw new Error("bad admin address");
  const recorderDefault = admin;
  const recorder = ((await ask(`Recorder address [${recorderDefault}]: `)).trim() || recorderDefault);
  if (!/^0x[0-9a-fA-F]{40}$/.test(recorder)) throw new Error("bad recorder address");

  const rpc = (await ask("Base RPC [https://mainnet.base.org]: ")).trim() || "https://mainnet.base.org";

  // 3. Compile
  console.log("\nCompiling…");
  const input = {
    language: "Solidity",
    sources: { [FILE]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } },
    },
  };
  const findImports = (p) => {
    for (const base of ["./node_modules", "../node_modules", "./server/node_modules", `${process.env.HOME}/workspace/monad-dex/dex-app/server/node_modules`]) {
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
  const contract = out.contracts[FILE][CONTRACT];
  const abi = contract.abi;
  const bytecode = "0x" + contract.evm.bytecode.object;
  console.log(`Compiled OK — bytecode ${(bytecode.length - 2) / 2} bytes`);

  // 4. Deploy
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk.trim(), provider);
  console.log(`\nDeployer: ${wallet.address}`);
  const bal = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(bal)} ETH`);
  if (bal === 0n) throw new Error("deployer has no ETH for gas");

  console.log(`\nConstructor args:\n  admin:    ${admin}\n  recorder: ${recorder}`);
  const confirm = (await ask("Deploy? [y/N]: ")).trim().toLowerCase();
  if (confirm !== "y") { console.log("Aborted."); process.exit(0); }

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const deployed = await factory.deploy(admin, recorder);
  console.log(`Tx sent: ${deployed.deploymentTransaction().hash}`);
  await deployed.waitForDeployment();
  const addr = await deployed.getAddress();
  console.log(`\n✓ Deployed at: ${addr}`);
  console.log(`  Basescan: https://basescan.org/address/${addr}`);

  // 5. Verify roles
  const c = new ethers.Contract(addr, abi, provider);
  const hasAdmin = await c.hasRole(await c.DEFAULT_ADMIN_ROLE(), admin);
  const hasRecorder = await c.hasRole(await c.RECORDER_ROLE(), recorder);
  console.log(`\nRole check: admin=${hasAdmin} recorder=${hasRecorder}`);

  // 6. Optional: set custom fee parameters (deployer must be admin/governor)
  console.log(`\nCurrent fees: base=${await c.baseIntegratorFeeBps()}bps, maxDiscount=${await c.maxDiscountBps()}bps, threshold=${await c.requiredHonorThreshold()}`);
  const setFees = (await ask("Set custom fee parameters? [y/N]: ")).trim().toLowerCase();
  if (setFees === "y") {
    const base = (await ask("  baseIntegratorFeeBps [100]: ")).trim() || "100";
    const disc = (await ask("  maxDiscountBps [50]: ")).trim() || "50";
    const thresh = (await ask("  requiredHonorThreshold [55]: ")).trim() || "55";
    if (Number(disc) > Number(base)) throw new Error("maxDiscount cannot exceed base fee (contract reverts)");
    if (Number(thresh) > 100) throw new Error("threshold must be <= 100");
    // Note: only works if deployer is admin (GOVERNOR_ROLE). If admin is the Safe,
    // run setFeeParameters via a Safe transaction instead.
    const isGovernor = await c.hasRole(await c.GOVERNOR_ROLE(), wallet.address);
    if (!isGovernor) {
      console.log(`\nDeployer is not governor — call setFeeParameters(${base}, ${disc}, ${thresh}) from the admin Safe.`);
    } else {
      const tx = await c.setFeeParameters(base, disc, thresh);
      console.log(`setFeeParameters tx: ${tx.hash}`);
      await tx.wait();
      console.log(`✓ Fees set: base=${base}bps, maxDiscount=${disc}bps, threshold=${thresh}`);
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`No further steps — roles were granted in the constructor.`);
  rl.close();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
