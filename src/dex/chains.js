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
      // Added 2026-11-17. Each was read on Base (symbol, decimals, contract code) and priced through KyberSwap from
      // ETH: under 0.5% loss at about $20 and 0.25% at about $200. Candidates came from the owner's Uniswap/SushiSwap
      // list and from the busiest Base pools over 14 days (GeckoTerminal), SushiSwap's Base pools included.
      { symbol: 'cbBTC', address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8 },
      { symbol: 'USDT', address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
      { symbol: 'DAI', address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18 },
      { symbol: 'cbETH', address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', decimals: 18 },
      { symbol: 'AERO', address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', decimals: 18 },
      { symbol: 'VIRTUAL', address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', decimals: 18 },
      { symbol: 'AAVE', address: '0x63706e401c06ac8513145b7687A14804d17f814b', decimals: 18 },
      { symbol: 'EURC', address: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', decimals: 6 },
      { symbol: 'USDbC', address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6 },
      { symbol: 'tBTC', address: '0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b', decimals: 18 },
      { symbol: 'cbDOGE', address: '0xcbD06E5A2B0C65597161de254AA074E489dEb510', decimals: 8 },
      { symbol: 'cbHYPE', address: '0xB200000000000000000000451d033a5000cb479e', decimals: 18 },
      { symbol: 'cbXRP', address: '0xcb585250f852C6c6bf90434AB21A00f02833a4af', decimals: 6 },
      { symbol: 'cbZEC', address: '0xB2000000000000000000008501b13360000cb2EC', decimals: 8 },
      { symbol: 'CHIP', address: '0x0C1c1C109FE34733fca54b82d7B46B75CFb71F6e', decimals: 18 },
      { symbol: 'COOKIE', address: '0xC0041EF357B183448B235a8Ea73Ce4E4eC8c265F', decimals: 18 },
      { symbol: 'CTR', address: '0x11030f79109269d796fd0FB956D6244e502757f7', decimals: 18 },
      { symbol: 'DIEM', address: '0xF4d97F2da56e8c3098f3a8D538DB630A2606a024', decimals: 18 },
      { symbol: 'DRV', address: '0x9d0E8f5b25384C7310CB8C6aE32C8fbeb645d083', decimals: 18 },
      { symbol: 'ELSA', address: '0x29cC30f9D113B356Ce408667aa6433589CeCBDcA', decimals: 18 },
      { symbol: 'ICNT', address: '0xE0Cd4cAcDdcBF4f36e845407CE53E87717b6601d', decimals: 18 },
      { symbol: 'JitoSOL', address: '0x97bE14Dd8f994A5364573BC035D85309E7CB34de', decimals: 9 },
      { symbol: 'LCAP', address: '0x4dA9A0f397dB1397902070f93a4D6ddBC0E0E6e8', decimals: 18 },
      { symbol: 'LUSD', address: '0x368181499736d0c0CC614DBB145E2EC1AC86b8c6', decimals: 18 },
      { symbol: 'MOCA', address: '0x2B11834Ed1FeAEd4b4b3a86A6F571315E25A884D', decimals: 18 },
      { symbol: 'O', address: '0x182FA643E5f29d5EcA75e7b9CF9336A3fe4620b2', decimals: 18 },
      { symbol: 'OUSD', address: '0xB2000000000000000000002fEb517dFeC7415344', decimals: 6 },
      { symbol: 'PENDLE', address: '0xA99F6e6785Da0F5d6fB42495Fe424BCE029Eeb3E', decimals: 18 },
      { symbol: 'PLAY', address: '0x853a7c99227499DbA9dB8C3A02aA691aFDeBf841', decimals: 18 },
      { symbol: 'SOSO', address: '0x624e2e7fDc8903165F64891672267AB0FCB98831', decimals: 18 },
      { symbol: 'SPX', address: '0x50dA645f148798F68EF2d7dB7C1CB22A6819bb2C', decimals: 8 },
      { symbol: 'VVV', address: '0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf', decimals: 18 },
      { symbol: 'XDP', address: '0x07b3D902783c3C12b077508c3B5c00113d1291D0', decimals: 18 },
      { symbol: 'ZCHF', address: '0xD4dD9e2F021BB459D5A5f6c24C12fE09c5D45553', decimals: 18 },
      { symbol: 'ZEN', address: '0xf43eB8De897Fbc7F2502483B2Bef7Bb9EA179229', decimals: 18 },
      { symbol: 'ZRO', address: '0x6985884C4392D348587B19cb9eAAf157F13271cd', decimals: 18 },
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
      // Wrapped MON: the same contract MON stands in for above, here as an ordinary token you can hold and trade.
      { symbol: 'WMON', address: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A', decimals: 18 },
      // Added after checking each contract on Monad (name, symbol, decimals) and getting a live KyberSwap
      // route for it from MON. Order matters: the first two stay MON and USDC (the app defaults to them).
      { symbol: 'USDT0', address: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', decimals: 6 },
      { symbol: 'WETH', address: '0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242', decimals: 18 },
      { symbol: 'WBTC', address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', decimals: 8 },
      { symbol: 'AUSD', address: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a', decimals: 6 },
      { symbol: 'sMON', address: '0xA3227C5969757783154C60bF0bC1944180ed81B9', decimals: 18 }, // Kintsu staked MON
      { symbol: 'gMON', address: '0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081', decimals: 18 },
      { symbol: 'shMON', address: '0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c', decimals: 18 }, // ShMonad
      // From Monad's official token list (github.com/monad-crypto/token-list), keeping only coins whose on-chain
      // symbol and decimals match the list AND that priced within 0.5% from MON at $16 and 0.25% at $166.
      { symbol: 'GHO', address: '0xfc421aD3C883Bf9E7C4f42dE845C4e4405799e73', decimals: 18 },
      { symbol: 'cbBTC', address: '0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b', decimals: 8 },
      { symbol: 'LBTC', address: '0xecAc9C5F704e954931349Da37F60E39f515c11c1', decimals: 8 },
      { symbol: 'Cake', address: '0xF59D81cd43f620E722E07f9Cb3f6E41B031017a3', decimals: 18 },
      { symbol: 'avUSD', address: '0x0D9D741FE423Cd5419e4BCb6cB2FfA87AFa93bA4', decimals: 18 },
      { symbol: 'mUSD', address: '0xacA92E438df0B2401fF60dA7E4337B687a2435DA', decimals: 6 },
      { symbol: 'XAUt0', address: '0x01bFF41798a0BcF287b996046Ca68b395DbC1071', decimals: 6 }, // Tether Gold
      { symbol: 'aprMON', address: '0x0c65A0BC65a5D819235B71F554D210D3F80E0852', decimals: 18 }, // aPriori staked MON
      { symbol: 'syrupUSDC', address: '0xaB6e5a0C3799d020c790D34F7B2C02639e238AF7', decimals: 6 }, // Maple
      // Clanker token created by the project owner. Verified on Monad (MonazolaM, 18 decimals) with a live route;
      // its pool is small (about $2k when added), so large swaps will show a big price impact in the quote.
      { symbol: 'MONAZ', address: '0x261E706FA130825b48b99989732a4eE31fFFeB07', decimals: 18 },
      // Added 2026-11-17 from Monad's busiest pools over 14 days (GeckoTerminal, PancakeSwap's Monad pools included).
      // Same checks as above: on Monad's official token list, read on Monad, priced through KyberSwap from MON.
      { symbol: 'EURW', address: '0x1111B3DED9F1fE1801AD4ebeF8E2788183a24111', decimals: 6 },
      { symbol: 'USDat', address: '0x0Bb150DFa86EA5d7742F07FEfCD8E8edA81D64eF', decimals: 6 },
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
  // BNB Chain and Avalanche (swaps). Every token below was read on its own chain (symbol and decimals) and priced
  // from the chain's wrapped native coin through KyberSwap at two trade sizes, keeping only coins under 0.5% loss
  // at about $20 and 0.25% at about $200. NOTE: BNB Chain's USDC and USDT have 18 decimals, not 6.
  bsc: {
    key: 'bsc',
    label: 'BNB Chain',
    chainId: 56,
    native: 'BNB',
    color: '#f0b90b',
    rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc.drpc.org'],
    explorer: 'https://bscscan.com',
    sources: ['lifi', 'kyberswap', 'velora', 'oneinch', 'zerox'], // quoted live; Zerion and Uniswap left off until verified
    kyberName: 'bsc',
    tokens: [
      { symbol: 'BNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18, isNative: true }, // WBNB (wrapped)
      { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
      { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
      { symbol: 'BTCB', address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', decimals: 18 },
      { symbol: 'ETH', address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', decimals: 18 }, // Binance-Peg ETH
      { symbol: 'CAKE', address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', decimals: 18 },
      // Added 2026-11-15 from the PancakeSwap extended token list (open token list, tokens.pancakeswap.finance).
      { symbol: 'DAI', address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', decimals: 18 }, // Binance-Peg DAI
      { symbol: 'FDUSD', address: '0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409', decimals: 18 },
      { symbol: 'LINK', address: '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD', decimals: 18 },
      { symbol: 'XRP', address: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE', decimals: 18 },
      { symbol: 'ADA', address: '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47', decimals: 18 },
      { symbol: 'DOGE', address: '0xbA2aE424d960c26247Dd6c32edC70B295c744C43', decimals: 8 },
      { symbol: 'DOT', address: '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402', decimals: 18 },
      { symbol: 'UNI', address: '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1', decimals: 18 },
      { symbol: 'LTC', address: '0x4338665CBB7B2485A8855A139b75D5e34AB0DB94', decimals: 18 },
      { symbol: 'BCH', address: '0x8fF795a6F4D97E7887C79beA79aba5cc76444aDf', decimals: 18 },
      { symbol: 'TRX', address: '0xCE7de646e7208a4Ef112cb6ed5038FA6cC6b12e3', decimals: 6 },
      { symbol: 'ATOM', address: '0x0Eb3a705fc54725037CC9e008bDede697f62F335', decimals: 18 },
      { symbol: 'AVAX', address: '0x1CE0c2827e2eF14D5C4f29a091d735A204794041', decimals: 18 },
      { symbol: 'SOL', address: '0x570A5D26f7765Ecb712C0924E4De545B89fD43dF', decimals: 18 },
      { symbol: 'NEAR', address: '0x1Fa4a73a3F0133f0025378af00236f3aBDEE5D63', decimals: 18 },
      { symbol: 'FIL', address: '0x0D8Ce2A99Bb6e3B7Db580eD848240e4a0F9aE153', decimals: 18 },
      // Added 2026-11-17 from the owner's Uniswap token list: read on BNB Chain and priced through KyberSwap from BNB
      // (under 0.5% loss at about $20, 0.25% at about $200). The other BNB Chain candidates were too thin or not priced.
      { symbol: 'AAVE', address: '0xfb6115445Bff7b52FeB98650C87f44907E58f802', decimals: 18 },
      { symbol: 'ASTER', address: '0x000Ae314E2A2172a039B26378814C252734f556A', decimals: 18 },
      { symbol: 'DNA', address: '0xA991F61940095AEA0724ef54077223B048c5CF7b', decimals: 18 },
    ],
  },
  avalanche: {
    key: 'avalanche',
    label: 'Avalanche',
    chainId: 43114,
    native: 'AVAX',
    color: '#e84142',
    rpcs: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche.drpc.org'],
    explorer: 'https://snowtrace.io',
    sources: ['lifi', 'kyberswap', 'velora', 'oneinch', 'zerox'], // quoted live; Zerion and Uniswap left off until verified
    kyberName: 'avalanche',
    tokens: [
      { symbol: 'AVAX', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', decimals: 18, isNative: true }, // WAVAX (wrapped)
      { symbol: 'USDC', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6 },
      { symbol: 'USDt', address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', decimals: 6 },
      { symbol: 'BTC.b', address: '0x152b9d0FdC40C096757F570A51E494bd4b943E50', decimals: 8 },
      { symbol: 'WETH.e', address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', decimals: 18 },
      // Added 2026-11-15 from the LFJ token list, cross-checked with SushiSwap's list and DeFi Llama pool TVL; each read on-chain
      // and priced on KyberSwap (kept only under 0.5% loss at $20 and 0.25% at $200).
      { symbol: 'sAVAX', address: '0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE', decimals: 18 },
      { symbol: 'avUSD', address: '0x24dE8771bC5DdB3362Db529Fc3358F2df3A0E346', decimals: 18 },
      { symbol: 'WBTC.e', address: '0x50b7545627a5162F82A992c33b87aDc75187B218', decimals: 8 },
      { symbol: 'LINK.e', address: '0x5947BB275c521040051D82396192181b413227A3', decimals: 18 },
      { symbol: 'DAI.e', address: '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70', decimals: 18 },
      { symbol: 'EURC', address: '0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD', decimals: 6 },
      { symbol: 'SolvBTC', address: '0xbc78D84Ba0c46dFe32cf2895a19939c86b81a777', decimals: 18 },
      { symbol: 'USDC.e', address: '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664', decimals: 6 },
      { symbol: 'USDT.e', address: '0xc7198437980c041c805A1EDcbA50c1Ce5db95118', decimals: 6 },
      { symbol: 'FRAX', address: '0xD24C2Ad096400B6FBcd2ad8B24E7acBc21A1da64', decimals: 18 },
      { symbol: 'AUSD', address: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a', decimals: 6 },
      { symbol: 'axlUSDC', address: '0xfaB550568C688d5D8A52C7d794cb93Edc26eC0eC', decimals: 6 },
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
