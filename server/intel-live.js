// Intel tab, live answers. Reads open, keyless data (DeFi Llama for DEX volume and TVL, GeckoTerminal for
// pools) and shapes it into the same message list the tab already draws. Nothing here is invented: every
// number comes from one of those two services, and a failed read says so instead of falling back to a guess.
// Questions this file does not recognise return null, and the caller serves the older sample answers.

const LLAMA = "https://api.llama.fi";
const GECKO = "https://api.geckoterminal.com/api/v2";
const MERKL = "https://api.merkl.xyz/v4";

// The app's chains, by the name each service uses for them. `words` are what a person might type.
export const INTEL_CHAINS = [
  { key: "monad", label: "Monad", llama: "Monad", gecko: "monad", chainId: 143, words: ["monad", "mon"] },
  { key: "base", label: "Base", llama: "Base", gecko: "base", chainId: 8453, words: ["base"] },
  {
    key: "optimism",
    label: "Optimism",
    llama: "Optimism",
    gecko: "optimism",
    chainId: 10,
    words: ["optimism", "op mainnet", "op"],
  },
  {
    key: "bsc",
    label: "BNB Chain",
    llama: "BSC",
    gecko: "bsc",
    chainId: 56,
    words: ["bnb chain", "bnb", "bsc", "binance"],
  },
  {
    key: "avalanche",
    label: "Avalanche",
    llama: "Avalanche",
    gecko: "avax",
    chainId: 43114,
    words: ["avalanche", "avax"],
  },
  { key: "ink", label: "Ink", llama: "Ink", gecko: "ink", chainId: 57073, words: ["ink"] },
  { key: "unichain", label: "Unichain", llama: "Unichain", gecko: "unichain", chainId: 130, words: ["unichain"] },
];

// DEX names a question can filter pools by; the value is the fragment GeckoTerminal uses in its DEX ids.
const DEX_WORDS = {
  sushiswap: "sushiswap",
  sushi: "sushiswap",
  pancakeswap: "pancakeswap",
  pancake: "pancakeswap",
  aerodrome: "aerodrome",
  velodrome: "velodrome",
  uniswap: "uniswap",
  kuru: "kuru",
  "trader joe": "traderjoe",
  lfj: "traderjoe",
  pharaoh: "pharaoh",
  curve: "curve",
  balancer: "balancer",
};

const hasWord = (q, w) => new RegExp(`(^|[^a-z0-9])${w.replace(/ /g, "\\s+")}([^a-z0-9]|$)`).test(q);

/** Work out what is being asked. Returns null when the question is not one we can answer from live data. */
export function planQuestion(query) {
  const q = String(query || "").toLowerCase();
  const named = INTEL_CHAINS.find((c) => c.words.some((w) => hasWord(q, w)));
  const dexWord = Object.keys(DEX_WORDS).find((w) => hasWord(q, w));
  const dex = dexWord ? DEX_WORDS[dexWord] : null;
  const chain = named || INTEL_CHAINS[0];
  const base = { chain: chain.key, dex, chainNamed: !!named };
  if (/\b(merkl|merkle|rewards?|incentives?|apr|apy|yield|farm|farming|earn|alpha|campaigns?)\b/.test(q))
    return { ...base, kind: "merkl" };
  if (/\b(compare|comparison|versus|vs|which chain|across chains|all chains|every chain|tvl)\b/.test(q) && !dex)
    return { ...base, kind: "chains" };
  if (/\b(tokens?|coins?|trending|most traded)\b/.test(q)) return { ...base, kind: "tokens" };
  if (/\bpools?\b|\bpairs?\b|\bliquidity\b/.test(q) || dex) return { ...base, kind: "pools" };
  if (/\b(volume|dex|dexes|dexs|exchanges?|market share|biggest|largest|top)\b/.test(q))
    return { ...base, kind: "dexes" };
  if (named) return { ...base, kind: "dexes" };
  return null;
}

/** $1.07B, $34.7M, $9.2K, $512. Used for table cells and sentences. */
export function usd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "n/a";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
const pct = (n) => (Number.isFinite(Number(n)) ? `${Number(n) > 0 ? "+" : ""}${Number(n).toFixed(1)}%` : "n/a");

const thought = (parts) => ({ systemMessage: { text: { textType: "THOUGHT", parts } } });
const final = (text) => ({ systemMessage: { text: { textType: "FINAL_RESPONSE", parts: [text] } } });
const follow = (parts) => ({ systemMessage: { text: { parts } } });
const table = (names, data) => ({
  systemMessage: { data: { result: { schema: { fields: names.map((name) => ({ name })) }, data } } },
});
const chart = (values, xTitle, yTitle) => ({
  systemMessage: {
    chart: {
      result: {
        vegaConfig: {
          data: { values },
          mark: { type: "bar", color: "#836ef9" },
          encoding: {
            x: { field: "name", type: "nominal", title: xTitle },
            y: { field: "value", type: "quantitative", title: yTitle },
          },
        },
      },
    },
  },
});

const CACHE_MS = 5 * 60 * 1000;

export function createIntel({ fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const cache = new Map();
  async function getJson(url) {
    const hit = cache.get(url);
    if (hit && now() - hit.at < CACHE_MS) return hit.body;
    const r = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`${new URL(url).hostname} answered ${r.status}`);
    const body = await r.json();
    cache.set(url, { at: now(), body });
    return body;
  }
  const dexTable = (c) =>
    getJson(
      `${LLAMA}/overview/dexs/${encodeURIComponent(c.llama)}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`,
    );

  async function dexes(c) {
    const j = await dexTable(c);
    const rows = (j.protocols || [])
      .filter((p) => Number(p.total7d) > 0)
      .sort((a, b) => b.total7d - a.total7d)
      .slice(0, 8);
    if (!rows.length) return [final(`DeFi Llama lists no DEX volume on ${c.label} for the last week.`)];
    const two = (p) => Number(p.total7d || 0) + Number(p.total14dto7d || 0);
    const top = rows[0];
    const share = j.total7d ? ((top.total7d / j.total7d) * 100).toFixed(0) : null;
    return [
      thought([
        `Read DeFi Llama's DEX volume table for ${c.label}.`,
        "Ranked the DEXes by the last 7 days of trading volume.",
      ]),
      table(
        ["DEX", "24h", "7 days", "14 days", "7d change"],
        rows.map((p) => ({
          DEX: p.displayName || p.name,
          "24h": usd(p.total24h),
          "7 days": usd(p.total7d),
          "14 days": usd(two(p)),
          "7d change": pct(p.change_7dover7d),
        })),
      ),
      chart(
        rows.map((p) => ({ name: p.displayName || p.name, value: Math.round(p.total7d) })),
        "DEX",
        "7-day volume (USD)",
      ),
      final(
        `### DEX volume on ${c.label}\n` +
          `All DEXes on ${c.label} traded **${usd(j.total24h)}** in the last 24 hours and **${usd(j.total7d)}** over 7 days ` +
          `(${pct(j.change_7dover7d)} against the week before).\n` +
          `The largest is **${top.displayName || top.name}** with ${usd(top.total7d)} over 7 days` +
          (share ? `, about ${share}% of the chain's volume.` : "."),
      ),
      follow([`Top pools on ${c.label}`, `Most traded tokens on ${c.label}`, "Compare all chains"]),
    ];
  }

  async function chains() {
    const tvl = await getJson(`${LLAMA}/v2/chains`);
    const rows = [];
    const missed = [];
    for (const c of INTEL_CHAINS) {
      const t = tvl.find((x) => x.chainId === c.chainId && Number(x.tvl) > 0);
      let v = null;
      try {
        v = await dexTable(c);
      } catch {
        missed.push(c.label);
      }
      rows.push({
        c,
        tvl: t ? Number(t.tvl) : null,
        d1: v?.total24h ?? null,
        d7: v?.total7d ?? null,
        ch: v?.change_7dover7d ?? null,
      });
    }
    rows.sort((a, b) => (b.d7 || 0) - (a.d7 || 0));
    const lead = rows[0];
    return [
      thought([
        "Read DeFi Llama's chain TVL list and its DEX volume table for each chain this app supports.",
        "Ranked the chains by the last 7 days of DEX volume.",
      ]),
      table(
        ["Chain", "TVL", "DEX 24h", "DEX 7 days", "7d change"],
        rows.map((r) => ({
          Chain: r.c.label,
          TVL: r.tvl === null ? "n/a" : usd(r.tvl),
          "DEX 24h": r.d1 === null ? "n/a" : usd(r.d1),
          "DEX 7 days": r.d7 === null ? "n/a" : usd(r.d7),
          "7d change": pct(r.ch),
        })),
      ),
      chart(
        rows.filter((r) => r.d7).map((r) => ({ name: r.c.label, value: Math.round(r.d7) })),
        "Chain",
        "7-day DEX volume (USD)",
      ),
      final(
        `### The app's chains, side by side\n` +
          `**${lead.c.label}** had the most DEX trading over the last 7 days (${usd(lead.d7)}).` +
          (missed.length ? `\nCould not read DEX volume for: ${missed.join(", ")}.` : ""),
      ),
      follow(["DEX volume on Monad", "Top pools on Base", "Most traded tokens on Monad"]),
    ];
  }

  // GeckoTerminal pools for a chain, optionally only one DEX family (all its versions on that chain).
  async function poolList(c, dex) {
    const inc = "include=base_token,quote_token,dex";
    let pages = [];
    if (dex) {
      const list = await getJson(`${GECKO}/networks/${c.gecko}/dexes?page=1`);
      const ids = (list.data || [])
        .map((d) => d.id)
        .filter((id) => id.includes(dex))
        .slice(0, 3);
      if (!ids.length) return { pools: [], names: {} };
      for (const id of ids)
        pages.push(
          await getJson(`${GECKO}/networks/${c.gecko}/dexes/${id}/pools?sort=h24_volume_usd_desc&${inc}&page=1`),
        );
    } else pages = [await getJson(`${GECKO}/networks/${c.gecko}/pools?sort=h24_volume_usd_desc&${inc}&page=1`)];
    const names = {};
    const pools = [];
    for (const p of pages) {
      for (const x of p.included || []) names[x.id] = x.attributes;
      pools.push(...(p.data || []));
    }
    pools.sort((a, b) => Number(b.attributes.volume_usd?.h24 || 0) - Number(a.attributes.volume_usd?.h24 || 0));
    return { pools, names };
  }

  async function pools(c, dex) {
    const { pools: all, names } = await poolList(c, dex);
    const where = dex ? `${dex} on ${c.label}` : c.label;
    const rows = all.filter((p) => Number(p.attributes.volume_usd?.h24) > 0).slice(0, 10);
    if (!rows.length) return [final(`GeckoTerminal lists no pools with trading in the last 24 hours for ${where}.`)];
    const dexName = (p) => names[p.relationships?.dex?.data?.id]?.name || p.relationships?.dex?.data?.id || "";
    const top = rows[0];
    return [
      thought([
        `Read GeckoTerminal's pool list for ${where}.`,
        "Ranked the pools by the last 24 hours of trading volume.",
      ]),
      table(
        ["Pool", "DEX", "24h volume", "Liquidity", "24h price"],
        rows.map((p) => ({
          Pool: p.attributes.name,
          DEX: dexName(p),
          "24h volume": usd(p.attributes.volume_usd.h24),
          Liquidity: usd(p.attributes.reserve_in_usd),
          "24h price": pct(p.attributes.price_change_percentage?.h24),
        })),
      ),
      chart(
        rows.map((p) => ({ name: p.attributes.name, value: Math.round(Number(p.attributes.volume_usd.h24)) })),
        "Pool",
        "24h volume (USD)",
      ),
      final(
        `### Busiest pools: ${where}\n` +
          `The most traded pool is **${top.attributes.name}** (${dexName(top)}) with ${usd(top.attributes.volume_usd.h24)} ` +
          `in the last 24 hours and ${usd(top.attributes.reserve_in_usd)} of liquidity.\n` +
          `A pool with high volume and little liquidity moves in price easily: check the quote before trading size.`,
      ),
      follow([`Most traded tokens on ${c.label}`, `DEX volume on ${c.label}`, "Compare all chains"]),
    ];
  }

  async function tokens(c) {
    const { pools: all, names } = await poolList(c, null);
    const by = {};
    for (const p of all) {
      const v = Number(p.attributes.volume_usd?.h24 || 0);
      for (const side of ["base_token", "quote_token"]) {
        const t = names[p.relationships?.[side]?.data?.id];
        if (!t) continue;
        const e = (by[t.address] ||= { symbol: t.symbol, address: t.address, vol: 0, pools: 0 });
        e.vol += v;
        e.pools += 1;
      }
    }
    const rows = Object.values(by)
      .filter((e) => e.vol > 0)
      .sort((a, b) => b.vol - a.vol)
      .slice(0, 10);
    if (!rows.length) return [final(`GeckoTerminal lists no traded tokens for ${c.label} in the last 24 hours.`)];
    return [
      thought([
        `Read GeckoTerminal's 20 busiest pools on ${c.label}.`,
        "Added up each token's 24-hour volume across the pools it appears in.",
      ]),
      table(
        ["Token", "24h volume", "Pools", "Contract"],
        rows.map((e) => ({ Token: e.symbol, "24h volume": usd(e.vol), Pools: e.pools, Contract: e.address })),
      ),
      chart(
        rows.map((e) => ({ name: e.symbol, value: Math.round(e.vol) })),
        "Token",
        "24h volume (USD)",
      ),
      final(
        `### Most traded tokens on ${c.label}\n` +
          `**${rows[0].symbol}** leads with ${usd(rows[0].vol)} traded in the last 24 hours across the chain's 20 busiest pools.\n` +
          `This counts only those 20 pools, so a token spread over many small pools ranks lower than it should. ` +
          `Being traded a lot does not make a token safe: check the contract address before you buy.`,
      ),
      follow([`Top pools on ${c.label}`, `DEX volume on ${c.label}`, "Compare all chains"]),
    ];
  }

  // Merkl reward campaigns that are live on a chain, biggest daily payout first.
  async function merkl(c, dex) {
    const all = await getJson(
      `${MERKL}/opportunities?chainId=${c.chainId}&status=LIVE&sort=rewards&order=desc&items=100`,
    );
    const live = (Array.isArray(all) ? all : []).filter(
      (o) =>
        Number(o.dailyRewards) > 0 &&
        (!dex ||
          String(o.protocol?.name || o.name)
            .toLowerCase()
            .replace(/\s/g, "")
            .includes(dex)),
    );
    const where = dex ? `${dex} on ${c.label}` : c.label;
    if (!live.length) return [final(`Merkl lists no live reward campaigns for ${where} right now.`)];
    const rows = live.slice(0, 10);
    const perDay = live.reduce((a, o) => a + Number(o.dailyRewards), 0);
    // "Best rate" only among campaigns with real money in them: a tiny pool can show a huge rate that vanishes on deposit.
    const deep = live.filter((o) => Number(o.tvl) >= 100000).sort((a, b) => Number(b.apr) - Number(a.apr))[0];
    const top = rows[0];
    return [
      thought([
        `Read Merkl's live reward campaigns for ${where} (its ${live.length} largest by daily payout).`,
        "Ranked them by rewards paid per day, and looked for the best rate among those holding at least $100K.",
      ]),
      table(
        ["Campaign", "Protocol", "Rewards / day", "Rate (APR)", "Deposited"],
        rows.map((o) => ({
          Campaign: o.name,
          Protocol: o.protocol?.name || "",
          "Rewards / day": usd(o.dailyRewards),
          "Rate (APR)": `${Number(o.apr || 0).toFixed(1)}%`,
          Deposited: usd(o.tvl),
        })),
      ),
      chart(
        rows.map((o) => ({ name: o.name, value: Math.round(Number(o.dailyRewards)) })),
        "Campaign",
        "Rewards per day (USD)",
      ),
      final(
        `### Merkl rewards: ${where}\n` +
          `These campaigns pay about **${usd(perDay)} a day** in total. The largest is **${top.name}** ` +
          `(${usd(top.dailyRewards)} a day, ${Number(top.apr || 0).toFixed(1)}% APR on ${usd(top.tvl)} deposited).\n` +
          (deep
            ? `Best rate among campaigns holding at least $100K: **${deep.name}** at ${Number(deep.apr).toFixed(1)}% APR.\n`
            : "") +
          `The rate falls as more money joins a campaign, and campaigns end: check Merkl before depositing. ` +
          `Rewards you have earned can be claimed in this app's Rewards tab.`,
      ),
      follow([
        `Top pools on ${c.label}`,
        `DEX volume on ${c.label}`,
        `Merkl rewards on ${c.key === "base" ? "Monad" : "Base"}`,
      ]),
    ];
  }

  /** Returns { messages, live, sources, asOf } or null when the question is not a live-data one. */
  async function answer(query) {
    const plan = planQuestion(query);
    if (!plan) return null;
    const c = INTEL_CHAINS.find((x) => x.key === plan.chain);
    const source =
      plan.kind === "merkl"
        ? "Merkl"
        : plan.kind === "pools" || plan.kind === "tokens"
          ? "GeckoTerminal"
          : "DeFi Llama";
    const out = { live: true, sources: [source], asOf: new Date(now()).toISOString(), plan };
    try {
      if (plan.kind === "chains") out.messages = await chains();
      else if (plan.kind === "merkl") out.messages = await merkl(c, plan.dex);
      else if (plan.kind === "pools") out.messages = await pools(c, plan.dex);
      else if (plan.kind === "tokens") out.messages = await tokens(c);
      else out.messages = await dexes(c);
    } catch (e) {
      out.failed = true;
      out.messages = [
        final(
          `Could not read ${source} just now (${String(e.message).slice(0, 80)}). No figures are shown. Try again in a minute.`,
        ),
      ];
    }
    return out;
  }

  return { answer };
}
