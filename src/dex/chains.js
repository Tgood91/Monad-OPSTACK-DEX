// Chain registry — the single source of truth.
// To add a chain: add one entry here + a matching AppKit network in config.js.
// To add a token: push to the chain's `tokens` array. Nothing else to touch.

export const NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export const CHAINS = {
  celo: {
    key: 'celo',
    label: 'Celo',
    chainId: 42220,
    native: 'CELO',
    color: '#35d07f',
    rpcs: ['https://rpc.ankr.com/celo', 'https://forno.celo.org'],
    explorer: 'https://celoscan.io',
    sources: ['velodrome', 'uniswap', 'lifi', 'zerion'],
    tokens: [
      { symbol: 'CELO', address: '0x471EcE3750Da237f93B8E339c536989b8978a438', decimals: 18, isNative: true },
      { symbol: 'USDC', address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', decimals: 6 },
      { symbol: 'USDT', address: '0x48065fbBE25f71C9282ddF5A9CDA2F9A8eCC70F', decimals: 6 },
      { symbol: 'cUSD', address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', decimals: 18 },
    ],
    // Velodrome Superchain v1.1 — verified on-chain 2026-10-07
    velo: {
      clQuoter: '0x426ef6F781bA0Fbc1A7b0D3399D6FA6548464C85',
      clFactory: '0x718E46d0962A66942E233760a8bd6038Ce54EdCD',
      clRouter: '0xc58C8aC11b62D9f649Ba6EBA19d6b70FcbBb2E80',
      v2Factory: '0x31832f2a97Fd20664D76Cc421207669b55CE4BC0',
      v2Router: '0x3a63171DD9BebF4D07BC782FECC7eb0b890C2A45',
    },
  },
  optimism: {
    key: 'optimism',
    label: 'Optimism',
    chainId: 10,
    native: 'ETH',
    color: '#ff0420',
    rpcs: ['https://optimism.drpc.org', 'https://1rpc.io/op'],
    explorer: 'https://optimistic.etherscan.io',
    sources: ['velodrome', 'uniswap', 'kyberswap', 'lifi', 'velora', 'oneinch', 'zerox', 'zerion'],
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
  base: {
    key: 'base',
    label: 'Base',
    chainId: 8453,
    native: 'ETH',
    color: '#0052ff',
    rpcs: ['https://developer-access-mainnet.base.org', 'https://1rpc.io/base', 'https://base.api.pocket.network'],
    explorer: 'https://basescan.org',
    // 1inch routers for Base — primary + fallbacks for direct execution
    routers: {
      primary: '0x111111125421cA6dc452d289314280a0f8842A65',   // 1inch v5
      fallback1: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
      fallback2: '0x6fF5693b99212Da76ad316178A184AB56D299b43',
    },
    sources: ['aerodrome', 'uniswap', 'kyberswap', 'lifi', 'velora', 'coinbase', 'oneinch', 'zerox', 'zerion'],
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
  unichain: {
    key: 'unichain',
    label: 'Unichain',
    chainId: 130,
    native: 'ETH',
    color: '#ff007a',
    rpcs: ['https://unichain.drpc.org'],
    explorer: 'https://uniscan.xyz',
    sources: ['uniswap', 'kyberswap', 'lifi', 'velora', 'oneinch', 'zerox', 'zerion'],
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
