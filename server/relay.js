// Relay (relay.link) cross-chain bridging. Keyless public API.
// Flow: quote -> the USER's wallet sends the returned transaction(s) on the origin chain (an exact-amount approval
// for ERC-20s, then a deposit into Relay's depository) -> a solver pays out on the destination -> poll status.
// Docs: https://api.relay.link/documentation/json. The server never signs and never holds funds.
//
// A quote is only passed to the browser after checkRelayQuote() agrees with it: every transaction must be on the
// origin chain, from the user's wallet, to a contract Relay publishes for that chain (GET /chains), for exactly the
// amount asked, with the user's wallet as recipient. Anything else is refused, because the wallet is about to sign it.

const API = "https://api.relay.link";
const ZERO = "0x0000000000000000000000000000000000000000";
const APPROVE = "0x095ea7b3";

// Chains offered in the bridge tab. All were live on Relay's /chains and quoted successfully on 2026-11-10.
export const RELAY_CHAINS = [8453, 10, 1, 143, 42161, 43114, 56, 57073, 130];

const lc = (s) => String(s || "").toLowerCase();
const isAddr = (s) => /^0x[0-9a-fA-F]{40}$/.test(String(s || ""));

export function createRelay({
  fetchImpl = (...a) => fetch(...a),
  now = () => Date.now(),
  chainsTtlMs = 10 * 60_000,
} = {}) {
  async function apiFetch(path, opts = {}) {
    const res = await fetchImpl(`${API}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", "User-Agent": "bushido-dapp/1.0", ...(opts.headers || {}) },
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || body.error || `Relay ${res.status} on ${path.split("?")[0]}`);
    return body;
  }

  let cache = null;
  let cacheAt = 0;
  let inflight = null;
  /** chainId -> Relay's own record for that chain (currencies and published contracts), cached. */
  async function chains() {
    if (cache && now() - cacheAt < chainsTtlMs) return cache;
    if (!inflight) {
      inflight = apiFetch("/chains")
        .then((j) => {
          if (!Array.isArray(j.chains)) throw new Error("bad chain list from Relay");
          cache = new Map(j.chains.map((c) => [Number(c.id), c]));
          cacheAt = now();
          return cache;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  async function chain(chainId) {
    const c = (await chains()).get(Number(chainId));
    if (!c || c.disabled || c.vmType !== "evm") throw new Error(`Relay does not serve chain ${chainId} right now`);
    return c;
  }

  /** Tokens Relay's solver holds on a chain: { symbol, address (null = the gas coin), decimals }. */
  async function relayTokens(chainId) {
    return tokensOf(await chain(chainId));
  }

  /**
   * Quote a bridge. { fromChainId, toChainId, fromToken ('native'|0x…), toToken, amountAtomic, wallet }
   * Returns a summary plus the checked transaction steps for the wallet to send.
   */
  async function relayQuote({ fromChainId, toChainId, fromToken, toToken, amountAtomic, wallet }) {
    const [from, to] = await Promise.all([chain(fromChainId), chain(toChainId)]);
    if (!from.depositEnabled) throw new Error(`Relay deposits are paused on ${from.displayName || from.name}`);
    const fi = findToken(tokensOf(from), fromToken);
    const ti = findToken(tokensOf(to), toToken);
    if (!fi) throw new Error("from token not supported by Relay on this chain");
    if (!ti) throw new Error("to token not supported by Relay on this chain");

    const q = await apiFetch("/quote/v2", {
      method: "POST",
      body: JSON.stringify({
        user: wallet,
        recipient: wallet,
        refundTo: wallet,
        originChainId: Number(fromChainId),
        destinationChainId: Number(toChainId),
        originCurrency: fi.address || ZERO,
        destinationCurrency: ti.address || ZERO,
        amount: String(amountAtomic),
        tradeType: "EXACT_INPUT",
      }),
    });

    const steps = checkRelayQuote(q, { chain: from, fromChainId, toChainId, fi, ti, amountAtomic, wallet });
    const d = q.details;
    return {
      requestId: steps.requestId,
      steps: steps.txs,
      fi,
      ti,
      amountOut: String(d.currencyOut.amount),
      minAmountOut: String(d.currencyOut.minimumAmount ?? d.currencyOut.amount),
      amountOutUsd: d.currencyOut.amountUsd ?? null,
      feeUsd: q.fees?.relayer?.amountUsd ?? null,
      timeEstimateSec: Number(d.timeEstimate) || null,
      impactPct: d.totalImpact?.percent ?? null,
    };
  }

  /** { status, inTxHashes, txHashes, details } for a request id. */
  async function relayStatus(requestId) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(requestId))) throw new Error("bad requestId");
    const s = await apiFetch(`/intents/status/v3?requestId=${requestId}`);
    return {
      status: String(s.status || "unknown"),
      inTxHashes: Array.isArray(s.inTxHashes) ? s.inTxHashes : [],
      txHashes: Array.isArray(s.txHashes) ? s.txHashes : [],
      details: s.details ? String(s.details).slice(0, 200) : null,
    };
  }

  return { relayTokens, relayQuote, relayStatus, chains };
}

/* ---------------- pure helpers (unit-tested) ---------------- */

/** Relay's currency list for a chain, normalised. The gas coin is the zero address there and `null` here. */
export function tokensOf(chain) {
  const seen = new Set();
  const out = [];
  for (const t of [chain.currency, ...(chain.solverCurrencies || [])]) {
    if (!t || !isAddr(t.address) || !Number.isInteger(t.decimals)) continue;
    const key = lc(t.address);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ symbol: String(t.symbol).slice(0, 16), address: key === ZERO ? null : t.address, decimals: t.decimals });
  }
  return out;
}

export function findToken(tokens, ref) {
  if (ref === "native") return tokens.find((t) => !t.address) || null;
  if (!isAddr(ref)) return null;
  return tokens.find((t) => t.address && lc(t.address) === lc(ref)) || null;
}

/** Every address Relay publishes for a chain: the depository plus its router/proxy/receiver contracts. */
export function publishedContracts(chain) {
  const set = new Set();
  const add = (v) => {
    if (isAddr(v) && lc(v) !== ZERO) set.add(lc(v));
  };
  add(chain.protocol?.v2?.depository);
  const walk = (o) => {
    for (const v of Object.values(o || {})) {
      if (v && typeof v === "object") walk(v);
      else add(v);
    }
  };
  walk(chain.contracts);
  return set;
}

/**
 * Refuse a quote unless every transaction in it is what the user asked for. Returns { requestId, txs } where each tx
 * is { id, to, data, value, chainId } and nothing else from Relay's response reaches the wallet.
 */
export function checkRelayQuote(q, { chain, fromChainId, toChainId, fi, ti, amountAtomic, wallet }) {
  const bad = (why) => {
    throw new Error(`Relay quote refused: ${why}`);
  };
  const d = q?.details;
  if (!d || !Array.isArray(q.steps) || !q.steps.length) bad("no steps");
  if (lc(d.sender) !== lc(wallet)) bad("sender is not your wallet");
  if (lc(d.recipient) !== lc(wallet)) bad("recipient is not your wallet");
  if (Number(d.currencyOut?.currency?.chainId) !== Number(toChainId)) bad("wrong destination chain");
  if (lc(d.currencyOut?.currency?.address) !== lc(ti.address || ZERO)) bad("wrong destination token");
  if (String(d.currencyIn?.amount) !== String(amountAtomic)) bad("amount differs from what you entered");
  if (!/^\d+$/.test(String(d.currencyOut?.amount || ""))) bad("no output amount");

  const allowed = publishedContracts(chain);
  if (!allowed.size) bad("Relay publishes no contracts for this chain");
  const amount = BigInt(amountAtomic);
  const native = !fi.address;
  const txs = [];
  let requestId = null;
  let deposits = 0;

  for (const step of q.steps) {
    if (step.kind !== "transaction") bad(`unexpected ${step.kind} step`);
    if (step.id !== "approve" && step.id !== "deposit") bad(`unexpected step "${step.id}"`);
    if (!Array.isArray(step.items) || step.items.length !== 1) bad("unexpected step shape");
    const t = step.items[0].data || {};
    const data = String(t.data || "0x");
    if (Number(t.chainId) !== Number(fromChainId)) bad("a transaction is on the wrong chain");
    if (lc(t.from) !== lc(wallet)) bad("a transaction is not from your wallet");
    if (!isAddr(t.to) || !/^0x([0-9a-fA-F]{2})*$/.test(data) || !/^\d+$/.test(String(t.value ?? "")))
      bad("malformed transaction");
    const value = BigInt(t.value);

    if (step.id === "approve") {
      // approve(spender, amount) on the token being sent, to a published Relay contract, for exactly the amount.
      if (native) bad("approval for a gas coin");
      if (lc(t.to) !== lc(fi.address)) bad("approval is on a different token");
      if (value !== 0n || data.length !== 138 || data.slice(0, 10).toLowerCase() !== APPROVE)
        bad("not a plain approval");
      const spender = "0x" + data.slice(34, 74);
      if (!allowed.has(lc(spender))) bad("approval is for an unknown contract");
      if (BigInt("0x" + data.slice(74)) !== amount) bad("approval is not for the exact amount");
    } else {
      deposits++;
      if (!allowed.has(lc(t.to))) bad("deposit goes to an unknown contract");
      if (value !== (native ? amount : 0n)) bad("deposit value differs from the amount");
    }
    requestId = step.requestId || requestId;
    txs.push({ id: step.id, to: t.to, data, value: value.toString(), chainId: Number(t.chainId) });
  }
  if (deposits !== 1) bad("expected exactly one deposit");
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(requestId))) bad("no request id");
  return { requestId, txs };
}

const relay = createRelay();
export const { relayTokens, relayQuote, relayStatus } = relay;
