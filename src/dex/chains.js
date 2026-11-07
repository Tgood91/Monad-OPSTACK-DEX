// Chain registry — the single source of truth.
// To add a chain: add one entry here + a matching AppKit network in config.js.
// To add a token: push to the chain's `tokens` array. Nothing else to touch.

export const NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export const CHAINS = {
  base: {
    key: 'base',
    label: 'Base',
    chainId: 8453,
    native: 'ETH',
    color: '#0052ff',
    // Checked 2026-11-05: developer-access-mainnet.base.org unreachable, 1rpc.io/base erroring.
    rpcs: ['https://mainnet.base.org', 'https://base.api.pocket.network', 'https://base.drpc.org'],
    explorer: 'https://basescan.org',
    // Aggregator router contracts on Base (reference only; not read by the code:
    // swaps use the `to` address each source's API returns).
    routers: {
      primary: '0x111111125421cA6dc452d289314280a0f8842A65',   // 1inch AggregationRouter V6 (the 1inch /swap/v6.0 API targets V6; V5 is 0x1111111254EEB25477B68fb85Ed929f73A960582)
      fallback1: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', // LI.FI Diamond (LI.FI's router), not 1inch
      fallback2: '0x6fF5693b99212Da76ad316178A184AB56D299b43', // Uniswap Universal Router on Base, not 1inch
    },
    sources: ['aerodrome', 'uniswap', 'kyberswap', 'lifi', 'velora', 'coinbase', 'oneinch', 'fusion', 'zerox', 'zerion'],
    kyberName: 'base',
    tokens: [
      { symbol: 'ETH', address: '0x4200000000000000000000000000000000000006', decimals: 18, isNative: true },
      { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    ],
    // Aerodrome on Base (Velodrome's ve(3,3) fork). Router2 Route struct is
    // 4 fields: (from, to, stable, factory). Keyless on-chain quotes.
    aero: {
      v2Router: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
      v2Factory: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
    },
  },
  monad: {
    key: 'monad',
    label: 'Monad',
    chainId: 143,
    native: 'MON',
    color: '#836ef9',
    rpcs: ['https://rpc.monad.xyz', 'https://monad-mainnet.drpc.org'],
    explorer: 'https://monadscan.com',
    // Monad has no on-chain Velodrome/Aerodrome/Uniswap deployment in this app and
    // Zerion does not support Monad, so quotes come from the aggregators below.
    // A source that doesn't route on Monad reports "no liquidity" in the quote list.
    // Velora (ParaSwap) rejects chain 143 — 'Invalid network' (checked 2026-11-02).
    sources: ['lifi', 'kyberswap', 'oneinch', 'fusion', 'zerox'],
    kyberName: 'monad',
    tokens: [
      { symbol: 'MON', address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', decimals: 18, isNative: true }, // WMON (wrapped)
      { symbol: 'USDC', address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', decimals: 6 },
      // Added after checking each contract on Monad (name, symbol, decimals) and getting a live KyberSwap
      // route for it from MON. Order matters: the first two stay MON and USDC (the app defaults to them).
      { symbol: 'USDT0', address: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', decimals: 6 },
      { symbol: 'WETH', address: '0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242', decimals: 18 },
      { symbol: 'WBTC', address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', decimals: 8 },
      { symbol: 'AUSD', address: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a', decimals: 6 },
      { symbol: 'sMON', address: '0xA3227C5969757783154C60bF0bC1944180ed81B9', decimals: 18 }, // Kintsu staked MON
      { symbol: 'gMON', address: '0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081', decimals: 18 },
      { symbol: 'shMON', address: '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c', decimals: 18 }, // ShMonad
    ],
  },
  optimism: {
    key: 'optimism',
    label: 'Optimism',
    chainId: 10,
    native: 'ETH',
    color: '#ff0420',
    rpcs: ['https://optimism.drpc.org', 'https://mainnet.optimism.io'],
    explorer: 'https://optimistic.etherscan.io',
    sources: ['velodrome', 'uniswap', 'kyberswap', 'lifi', 'velora', 'oneinch', 'fusion', 'zerox', 'zerion'],
    kyberName: 'optimism',
    tokens: [
      { symbol: 'ETH', address: '0x4200000000000000000000000000000000000006', decimals: 18, isNative: true },
      { symbol: 'USDC', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6 },
      { symbol: 'USDT', address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6 },
      { symbol: 'DAI', address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 },
      { symbol: 'VELO', address: '0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db', decimals: 18 },
      { symbol: 'OP', address: '0x4200000000000000000000000000000000000042', decimals: 18 },
      { symbol: 'WBTC', address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095', decimals: 8 },
    ],
    // Velodrome original Optimism deployment — verified on-chain 2026-10-07
    velo: {
      clQuoter: '0xAd432b2ca49965266133F2bd4c17dc1Ec12f5DEB',
      clFactory: '0xe13Dd1fbA721Aa81a1826D9523AC9BC7d260c879',
      clRouter: '0xbA3aEe516399388C779463183d00bB579f5041Ca',
      v2Factory: '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a',
      v2Router: '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858',
    },
  },
  ink: {
    key: 'ink',
    label: 'Ink',
    chainId: 57073,
    native: 'ETH',
    color: '#7c5cff',
    rpcs: ['https://rpc-gel.inkonchain.com'],
    explorer: 'https://explorer.inkonchain.com',
    sources: ['velodrome', 'uniswap', 'lifi', 'zerox', 'zerion'],
    tokens: [
      { symbol: 'ETH', address: '0x4200000000000000000000000000000000000006', decimals: 18, isNative: true },
      { symbol: 'USDC', address: '0x2D270e6886d130D724215A266106e6832161EAEd', decimals: 6 },
    ],
    // Velodrome Superchain — verified on-chain 2026-10-07
    velo: {
      clQuoter: '0x426ef6F781bA0Fbc1A7b0D3399D6FA6548464C85',
      clFactory: '0x718E46d0962A66942E233760a8bd6038Ce54EdCD',
      clRouter: '0xc58C8aC11b62D9f649Ba6EBA19d6b70FcbBb2E80',
      v2Router: '0x3a63171DD9BebF4D07BC782FECC7eb0b890C2A45',
    },
  },
  unichain: {
    key: 'unichain',
    label: 'Unichain',
    chainId: 130,
    native: 'ETH',
    color: '#ff007a',
    rpcs: ['https://unichain.drpc.org', 'https://mainnet.unichain.org'],
    explorer: 'https://uniscan.xyz',
    sources: ['uniswap', 'kyberswap', 'lifi', 'velora', 'oneinch', 'fusion', 'zerox', 'zerion'],
    kyberName: 'unichain',
    tokens: [
      { symbol: 'ETH', address: '0x4200000000000000000000000000000000000006', decimals: 18, isNative: true },
      { symbol: 'USDC', address: '0x078D782b760474a361dDA0AF3839290b0EF57AD6', decimals: 6 },
      { symbol: 'USDT', address: '0x588CE4F028D8e7B53B687865d6A67b3A54C75518', decimals: 6 },
    ],
  },
};

export const SOURCE_META = {
  aerodrome: { label: 'Aerodrome', tag: 'on-chain' },
  velodrome: { label: 'Velodrome', tag: 'on-chain' },
  coinbase: { label: 'Coinbase', tag: 'CDP swap' },
  uniswap: { label: 'Uniswap', tag: 'routing API' },
  kyberswap: { label: 'KyberSwap', tag: 'aggregator' },
  lifi: { label: 'LI.FI', tag: 'aggregator' },
  velora: { label: 'Velora', tag: 'aggregator' },
  oneinch: { label: '1inch', tag: 'aggregator · key' },
  fusion: { label: '1inch Fusion', tag: 'gasless · key' },
  zerox: { label: '0x', tag: 'aggregator · key' },
  zerion: { label: 'Zerion', tag: 'aggregator · key' },
};

export const QUOTE_TIMEOUT_MS = 8000;

export function getChain(key) {
  const c = CHAINS[key];
  if (!c) throw new Error(`Unknown chain: ${key}`);
  return c;
}

export function findToken(chainKey, symbol) {
  return getChain(chainKey).tokens.find(t => t.symbol === symbol);
}
