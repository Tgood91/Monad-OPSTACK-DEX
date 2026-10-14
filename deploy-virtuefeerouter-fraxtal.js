// VirtueFeeRouter deployment script for Fraxtal (chain ID 252).
// Prompts for everything — no hardcoded secrets.
// New file alongside deploy-virtuefeerouter.js (Base) — the Base script is untouched.
//
// Usage:
//   cd dex-app/server && npm install ethers solc @openzeppelin/contracts
//   node ../../deploy-virtuefeerouter-fraxtal.js
//
// What it does:
//   1. Compiles VirtueFeeRouter.sol (OpenZeppelin AccessControl)
//   2. Deploys to Fraxtal from your EOA with (admin, recorder) constructor args
//   3. Prints the deployed address + Fraxscan link
//
// Roles: admin gets DEFAULT_ADMIN_ROLE + GOVERNOR_ROLE; recorder gets RECORDER_ROLE.
// NOTE: the Base Safe (0xc829…) has no code on Fraxtal, so admin/recorder default
// to the deployer EOA here. Move roles to a Fraxtal Safe later if you want.
// Gas token on Fraxtal is frxETH.

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
const FRAXTAL_CHAIN_ID = 252n;
const FRAXTAL_RPC = "https://rpc.frax.com";

async function main() {
  console.log("\n=== VirtueFeeRouter Deployment (Fraxtal) ===\n");

  // 1. Locate source
  const guesses = [
    `${process.env.HOME}/workspace/user/files/${FILE}`,
    `./${FILE}`,
    `../${FILE}`,
    `../../contracts/${FILE}`,
    `../contracts/${FILE}`,
  ];
  let srcPath = null;
  for (const g of guesses) if (fs.existsSync(g)) { srcPath = g; break; }
  if (!srcPath) srcPath = await ask(`Path to ${FILE}: `);
  const source = fs.readFileSync(srcPath.trim(), "utf8");

  // 2. Private key, admin, recorder
  const pk = await ask("Deployer private key (0x…): ", true);
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk.trim())) throw new Error("bad private key format");

  const rpc = (await ask(`Fraxtal RPC [${FRAXTAL_RPC}]: `)).trim() || FRAXTAL_RPC;

  // Connect early so we know the deployer address for the admin default,
  // and can refuse to continue on the wrong chain.
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk.trim(), provider);
  const net = await provider.getNetwork();
  if (net.chainId !== FRAXTAL_CHAIN_ID) {
    throw new Error(`wrong chain: RPC reports chainId ${net.chainId}, expected 252 (Fraxtal)`);
  }
  console.log(`Connected to Fraxtal (chainId 252)`);
  console.log(`Deployer: ${wallet.address}`);

  // No Safe on Fraxtal at the Base address — default admin/recorder to the deployer EOA.
  const adminDefault = wallet.address;
  const admin = ((await ask(`Admin address [${adminDefault}]: `)).trim() || adminDefault);
  if (!/^0x[0-9a-fA-F]{40}$/.test(admin)) throw new Error("bad admin address");
  const recorder = ((await ask(`Recorder address [${admin}]: `)).trim() || admin);
  if (!/^0x[0-9a-fA-F]{40}$/.test(recorder)) throw new Error("bad recorder address");

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
  const bal = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(bal)} frxETH`);
  if (bal === 0n) throw new Error("deployer has no frxETH for gas");

  console.log(`\nConstructor args:\n  admin:    ${admin}\n  recorder: ${recorder}`);
  const confirm = (await ask("Deploy? [y/N]: ")).trim().toLowerCase();
  if (confirm !== "y") { console.log("Aborted."); process.exit(0); }

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const deployed = await factory.deploy(admin, recorder);
  console.log(`Tx sent: ${deployed.deploymentTransaction().hash}`);
  await deployed.waitForDeployment();
  const addr = await deployed.getAddress();
  console.log(`\n✓ Deployed at: ${addr}`);
  console.log(`  Fraxscan: https://fraxscan.com/address/${addr}`);

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
    // On Fraxtal the deployer EOA is admin by default, so this runs directly.
    // If you pointed admin at a Safe/contract, run setFeeParameters from it instead.
    const isGovernor = await c.hasRole(await c.GOVERNOR_ROLE(), wallet.address);
    if (!isGovernor) {
      console.log(`\nDeployer is not governor — call setFeeParameters(${base}, ${disc}, ${thresh}) from the admin address.`);
    } else {
      const tx = await c.setFeeParameters(base, disc, thresh);
      console.log(`setFeeParameters tx: ${tx.hash}`);
      await tx.wait();
      console.log(`✓ Fees set: base=${base}bps, maxDiscount=${disc}bps, threshold=${thresh}`);
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Verify on Fraxscan with the standard-json input (same solc 0.8.37 / 200 runs as Base).`);
  console.log(`Your free Etherscan key covers chain 252 via the V2 API — no paid plan needed.`);
  rl.close();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
