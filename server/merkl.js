// Merkl rewards proxy (server-side, KEYLESS — Merkl's read API needs no key,
// so there is nothing to hold in env or leak to the frontend bundle).
// Docs: https://docs.merkl.xyz
//
// Views:  live opportunities + the connected user's rewards per chain.
// Claims: this module builds the Distributor.claim(...) calldata from the
// LIVE merkle proofs and hands it to the frontend — the user's wallet signs
// and sends it. The server never holds keys and never sends transactions.
//
// The two rules that keep a claim from reverting (verified live 2026-11-03
// with eth_call dry-runs against the Distributor on Ethereum, Base, Monad):
//   1. Pass the CUMULATIVE amount — the Distributor pays amount - claimed.
//      Never subtract claimed yourself.
//   2. Include ONLY rows whose proofs are present AND amount > claimed.
//      One fully-claimed row in the batch reverts the whole call.
// Rewards settle into a new merkle root roughly every 8 hours; rows with a
// `pending` balance are not in a live root yet and cannot be claimed.

import { ethers } from "ethers";

const API = "https://api.merkl.xyz";

// Same Distributor address on every Merkl-supported chain.
export const MERKL_DISTRIBUTOR = "0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae";

// Chains the claim builder is enabled for (dry-run proven). Rewards and
// opportunities reads work for any Merkl chainId passed through.
export const MERKL_CHAINS = [
  { id: 1, name: "Ethereum" },
  { id: 8453, name: "Base" },
  { id: 143, name: "Monad" },
];

const claimIface = new ethers.Interface([
  "function claim(address[] users, address[] tokens, uint256[] amounts, bytes32[][] proofs)",
]);

async function merklGet(pathname) {
  const r = await fetch(`${API}${pathname}`, {
    headers: { "User-Agent": "monad-dex/1.0", Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`merkl ${r.status}`);
  return r.json();
}

const human = (raw, decimals) => Number(ethers.formatUnits(BigInt(raw), decimals));

// One rewards row, normalized for the frontend.
function rewardRow(chainId, r) {
  const amount = BigInt(r.amount);
  const claimed = BigInt(r.claimed);
  const pending = BigInt(r.pending || "0");
  const claimableRaw = amount - claimed;
  const claimable = human(claimableRaw, r.token.decimals);
  const price = Number(r.token.price || 0);
  return {
    chainId,
    token: r.token.address,
    symbol: r.token.symbol,
    decimals: r.token.decimals,
    amount: human(amount, r.token.decimals),
    claimed: human(claimed, r.token.decimals),
    pending: human(pending, r.token.decimals),
    claimable,
    claimableUsd: claimable * price,
    proofs: (r.proofs || []).length,
    // The exact filter the claim builder applies — shown so the UI can
    // explain why a row with a balance still has no Claim button.
    claimReady: (r.proofs || []).length > 0 && amount > claimed,
  };
}

async function fetchRewardRows(address, chainId, reload = false) {
  const q = reload ? `&reloadChainId=${chainId}` : "";
  const payload = await merklGet(
    `/v4/users/${address.toLowerCase()}/rewards?chainId=${chainId}${q}`
  );
  const groups = Array.isArray(payload) ? payload : [payload];
  return groups.flatMap((g) => (g.rewards || []).map((r) => ({ raw: r, row: rewardRow(chainId, r) })));
}

// GET /api/merkl/rewards?address=0x..[&chainId=143]
// Without chainId, returns the proven claim chains (1, 8453, 143).
export async function merklRewards(address, chainId) {
  const ids = chainId ? [Number(chainId)] : MERKL_CHAINS.map((c) => c.id);
  const per = await Promise.allSettled(ids.map((id) => fetchRewardRows(address, id)));
  const chains = ids.map((id, i) => {
    if (per[i].status !== "fulfilled") {
      return { chainId: id, error: String(per[i].reason?.message || per[i].reason).slice(0, 120), rewards: [] };
    }
    const rewards = per[i].value.map((x) => x.row);
    return {
      chainId: id,
      rewards,
      claimableUsd: rewards.reduce((s, r) => s + (r.claimReady ? r.claimableUsd : 0), 0),
    };
  });
  return { address, chains };
}

// GET /api/merkl/claim-data?address=0x..&chainId=143
// Fetch (forcing a fresh read) -> filter -> build the parallel arrays ->
// encode. Returns a ready-to-sign payload, or { claimable: false }.
export async function merklClaimData(address, chainId) {
  chainId = Number(chainId);
  if (!MERKL_CHAINS.some((c) => c.id === chainId)) {
    throw new Error(`claims not enabled for chain ${chainId}`);
  }
  const entries = await fetchRewardRows(address, chainId, true);
  const ready = entries.filter(({ raw }) => (raw.proofs || []).length > 0 && BigInt(raw.amount) > BigInt(raw.claimed));
  if (!ready.length) return { claimable: false, chainId, reason: "nothing claimable on this chain right now" };
  const users = ready.map(() => ethers.getAddress(address));
  const tokens = ready.map(({ raw }) => raw.token.address);
  const amounts = ready.map(({ raw }) => raw.amount); // cumulative, as-is — rule 1
  const proofs = ready.map(({ raw }) => raw.proofs);
  const data = claimIface.encodeFunctionData("claim", [users, tokens, amounts, proofs]);
  return {
    claimable: true,
    chainId,
    to: MERKL_DISTRIBUTOR,
    data,
    tokens: ready.map(({ row }) => ({ symbol: row.symbol, claimable: row.claimable, claimableUsd: row.claimableUsd })),
    totalUsd: ready.reduce((s, { row }) => s + row.claimableUsd, 0),
  };
}

// GET /api/merkl/opportunities?chainId=8453&items=20
// Top LIVE opportunities by daily rewards for the earn view.
export async function merklOpportunities({ chainId = 8453, items = 20 } = {}) {
  const payload = await merklGet(
    `/v4/opportunities?chainId=${Number(chainId)}&status=LIVE&items=${Math.min(Number(items) || 20, 100)}`
  );
  const list = Array.isArray(payload) ? payload : payload?.opportunities || [];
  return list.map((o) => ({
    chainId: Number(chainId),
    name: o.name,
    protocol: o.protocol?.name || null,
    action: o.action || null,
    apr: Number(o.apr || 0),
    tvl: Number(o.tvl || 0),
    dailyRewards: Number(o.dailyRewards || 0),
    tokens: (o.tokens || []).map((t) => t.symbol).filter(Boolean),
  }));
}
