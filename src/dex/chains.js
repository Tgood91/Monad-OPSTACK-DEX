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
      { symbol: 'cbLTC', address: '0xcb17C9Db87B595717C857a08468793f5bAb6445F', decimals: 8 },
      { symbol: 'cbADA', address: '0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c', decimals: 6 },
      { symbol: 'AAPLc', address: '0xb200000000000000000000C2e324d24d7eEcd1fb', decimals: 8 },
      { symbol: 'AMDc', address: '0xB2000000000000000000000d8Ce462E99ee7A47B', decimals: 8 },
      { symbol: 'AMZNc', address: '0xb200000000000000000000d9192b6B456483C2E8', decimals: 8 },
      { symbol: 'AVGOc', address: '0xB200000000000000000000Fc737aeA6196aB5a4c', decimals: 8 },
      { symbol: 'AX1', address: '0xcc9B87738d9d8Abd3294df6f1e4262B3dE413496', decimals: 18 },
      { symbol: 'AXIS', address: '0x5bE75e3b0aFf5D1A042A5363Ae36AcB1d6d755ea', decimals: 18 },
      { symbol: 'ADS', address: '0xb20A4Bd059F5914a2F8B9c18881c637f79efb7df', decimals: 11 },
      { symbol: 'AIXBT', address: '0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825', decimals: 18 },
      { symbol: 'apxUSD', address: '0xD993935E13851dd7517af10687EC7e5022127228', decimals: 18 },
      { symbol: 'AVNT', address: '0x696F9436B67233384889472Cd7cD58A6fB5DF4f1', decimals: 18 },
      { symbol: 'AWE', address: '0x1B4617734C43F6159F3a70b7E06d883647512778', decimals: 18 },
      { symbol: 'B3', address: '0xB3B32F9f8827D4634fE7d973Fa1034Ec9fdDB3B3', decimals: 18 },
      { symbol: 'Basecat', address: '0xB2000000000000000000004c27f6523082f41D01', decimals: 18 },
      { symbol: 'BEc', address: '0xb20000000000000000000016f9dfe862feBA122b', decimals: 8 },
      { symbol: 'BNKR', address: '0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b', decimals: 18 },
      { symbol: 'CHECK', address: '0x9126236476eFBA9Ad8aB77855c60eB5BF37586Eb', decimals: 18 },
      { symbol: 'ANTc', address: '0xb20000000000000000000016e38FD364d271Ba28', decimals: 8 },
      { symbol: 'CHIP', address: '0x0C1c1C109FE34733fca54b82d7B46B75CFb71F6e', decimals: 18 },
      { symbol: 'COOKIE', address: '0xC0041EF357B183448B235a8Ea73Ce4E4eC8c265F', decimals: 18 },
      { symbol: 'CP', address: '0x001AAd84c21A5CD4d696C56d44866e9703c43F77', decimals: 18 },
      { symbol: 'crvUSD', address: '0x417Ac0e078398C154EdFadD9Ef675d30Be60Af93', decimals: 18 },
      { symbol: 'CTR', address: '0x11030f79109269d796fd0FB956D6244e502757f7', decimals: 18 },
      { symbol: 'DEGEN', address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', decimals: 18 },
      { symbol: 'deSPXA', address: '0x9c5C365e764829876243d0b289733B9D2b729685', decimals: 18 },
      { symbol: 'DIEM', address: '0xF4d97F2da56e8c3098f3a8D538DB630A2606a024', decimals: 18 },
      { symbol: 'doginme', address: '0x6921B130D297cc43754afba22e5EAc0FBf8Db75b', decimals: 18 },
      { symbol: 'DOLA', address: '0x4621b7A9c75199271F773Ebd9A499dbd165c3191', decimals: 18 },
      { symbol: 'DRV', address: '0x9d0E8f5b25384C7310CB8C6aE32C8fbeb645d083', decimals: 18 },
      { symbol: 'EDGE', address: '0xED6E000dEF95780fb89734c07EE2ce9F6dcAf110', decimals: 18 },
      { symbol: 'ELSA', address: '0x29cC30f9D113B356Ce408667aa6433589CeCBDcA', decimals: 18 },
      { symbol: 'eUSD', address: '0xCfA3Ef56d303AE4fAabA0592388F19d7C3399FB4', decimals: 18 },
      { symbol: 'FAI', address: '0xb33Ff54b9F7242EF1593d2C9Bcd8f9df46c77935', decimals: 18 },
      { symbol: 'FLOCK', address: '0x5aB3D4c385B400F3aBB49e80DE2fAF6a88A7B691', decimals: 18 },
      { symbol: 'FUN', address: '0x16EE7ecAc70d1028E7712751E2Ee6BA808a7dd92', decimals: 18 },
      { symbol: 'GHST', address: '0xcD2F22236DD9Dfe2356D7C543161D4d260FD9BcB', decimals: 18 },
      { symbol: 'GOOGLc', address: '0xb2000000000000000000002D0BA3164cc74f58B7', decimals: 8 },
      { symbol: 'HIMSc', address: '0xB20000000000000000000043a599976181Bcf336', decimals: 8 },
      { symbol: 'HUNT', address: '0x37f0c2915CeCC7e977183B8543Fc0864d03E064C', decimals: 18 },
      { symbol: 'ICNT', address: '0xE0Cd4cAcDdcBF4f36e845407CE53E87717b6601d', decimals: 18 },
      { symbol: 'INFI', address: '0x9f4c76F421f47b3C234f841F477897f1D895177D', decimals: 18 },
      { symbol: 'jEUR', address: '0x4154550f4Db74Dc38d1FE98e1F3F28ed6daD627d', decimals: 18 },
      { symbol: 'JitoSOL', address: '0x97bE14Dd8f994A5364573BC035D85309E7CB34de', decimals: 9 },
      { symbol: 'KEYCAT', address: '0x9a26F5433671751C3276a065f57e5a02D2817973', decimals: 18 },
      { symbol: 'KNC', address: '0x28fe69Ff6864C1C218878BDCA01482D36B9D57b1', decimals: 18 },
      { symbol: 'KTA', address: '0xc0634090F2Fe6c6d75e61Be2b949464aBB498973', decimals: 18 },
      { symbol: 'LCAP', address: '0x4dA9A0f397dB1397902070f93a4D6ddBC0E0E6e8', decimals: 18 },
      { symbol: 'LMTS', address: '0x9EadbE35F3Ee3bF3e28180070C429298a1b02F93', decimals: 18 },
      { symbol: 'LUSD', address: '0x368181499736d0c0CC614DBB145E2EC1AC86b8c6', decimals: 18 },
      { symbol: 'MAG7.ssi', address: '0x9E6A46f294bB67c20F1D1E7AfB0bBEf614403B55', decimals: 8 },
      { symbol: 'MAMO', address: '0x7300B37DfdfAb110d83290A29DfB31B1740219fE', decimals: 18 },
      { symbol: 'METAc', address: '0xb2000000000000000000008bC8786B856E61707C', decimals: 8 },
      { symbol: 'MOCA', address: '0x2B11834Ed1FeAEd4b4b3a86A6F571315E25A884D', decimals: 18 },
      { symbol: 'MORPHO', address: '0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842', decimals: 18 },
      { symbol: 'msETH', address: '0x7Ba6F01772924a82D9626c126347A28299E98c98', decimals: 18 },
      { symbol: 'MSFTc', address: '0xB200000000000000000000Ab99cFa739E253872B', decimals: 8 },
      { symbol: 'MSTRc', address: '0xb2000000000000000000004884b426556b92883d', decimals: 8 },
      { symbol: 'msUSD', address: '0x526728DBc96689597F85ae4cd716d4f7fCcBAE9d', decimals: 18 },
      { symbol: 'MUc', address: '0xb200000000000000000000Fd2f87532B90095211', decimals: 8 },
      { symbol: 'NFLXc', address: '0xb20000000000000000000058B8c947e44011dFE6', decimals: 8 },
      { symbol: 'NOCK', address: '0x9B5E262cF9bb04869ab40b19AF91D2dc85761722', decimals: 16 },
      { symbol: 'NVDAc', address: '0xb20000000000000000000078ee7ce2fE4908108C', decimals: 8 },
      { symbol: 'O', address: '0x182FA643E5f29d5EcA75e7b9CF9336A3fe4620b2', decimals: 18 },
      { symbol: 'OPG', address: '0xFbC2051AE2265686a469421b2C5A2D5462FbF5eB', decimals: 18 },
      { symbol: 'OUSD', address: '0xB2000000000000000000002fEb517dFeC7415344', decimals: 6 },
      { symbol: 'PARTI', address: '0x59264f02D301281f3393e1385c0aEFd446Eb0F00', decimals: 18 },
      { symbol: 'PAXG', address: '0xe904AEA5E1b110c9174728fA2efFc8aeD19E98Ef', decimals: 18 },
      { symbol: 'PENDLE', address: '0xA99F6e6785Da0F5d6fB42495Fe424BCE029Eeb3E', decimals: 18 },
      { symbol: 'PLAY', address: '0x853a7c99227499DbA9dB8C3A02aA691aFDeBf841', decimals: 18 },
      { symbol: 'POD', address: '0xeD664536023d8E4b1640C394777D34aBAFF1dF8F', decimals: 18 },
      { symbol: 'PROS', address: '0x8B7DdE054BE9D180c1Be7FaE0874697374A49832', decimals: 18 },
      { symbol: 'QUID', address: '0x1a44233FAe8D50F1AeB3a5d58dd426ff4814Cb53', decimals: 18 },
      { symbol: 'RECALL', address: '0x1f16e03C1a5908818F47f6EE7bB16690b40D0671', decimals: 18 },
      { symbol: 'REPPO', address: '0xFf8104251E7761163faC3211eF5583FB3F8583d6', decimals: 18 },
      { symbol: 'rETH', address: '0xB6fe221Fe9EeF5aBa221c348bA20A1Bf5e73624c', decimals: 18 },
      { symbol: 'ROLL', address: '0xAb6363dA0C80cEF3Ae105Bd6241E30872355d021', decimals: 18 },
      { symbol: 'SAPIEN', address: '0xC729777d0470F30612B1564Fd96E8Dd26f5814E3', decimals: 18 },
      { symbol: 'SKHYc', address: '0xb200000000000000000000187f7071D6E321a7d2', decimals: 8 },
      { symbol: 'SNDKc', address: '0xb200000000000000000000397293Cb8cda9a10c5', decimals: 8 },
      { symbol: 'SOSO', address: '0x624e2e7fDc8903165F64891672267AB0FCB98831', decimals: 18 },
      { symbol: 'SPCXc', address: '0xb2000000000000000000007b9fcbd005511aCBd5', decimals: 8 },
      { symbol: 'SPX', address: '0x50dA645f148798F68EF2d7dB7C1CB22A6819bb2C', decimals: 8 },
      { symbol: 'superOETHb', address: '0xDBFeFD2e8460a6Ee4955A68582F85708BAEA60A3', decimals: 18 },
      { symbol: 'tGBP', address: '0x27f6c8289550fCE67f6B50BeD1F519966aFE5287', decimals: 18 },
      { symbol: 'TIBBIR', address: '0xA4A2E2ca3fBfE21aed83471D28b6f65A233C6e00', decimals: 18 },
      { symbol: 'TOSHI', address: '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4', decimals: 18 },
      { symbol: 'TRUST', address: '0x6cd905dF2Ed214b22e0d48FF17CD4200C1C6d8A3', decimals: 18 },
      { symbol: 'UNI', address: '0xc3De830EA07524a0761646a6a4e4be0e114a3C83', decimals: 18 },
      { symbol: 'VELVET', address: '0xbF927b841994731C573BDF09ceB0c6B0Aa887cDd', decimals: 18 },
      { symbol: 'VFY', address: '0xa749dE6c28262B7ffbc5De27dC845DD7eCD2b358', decimals: 18 },
      { symbol: 'VVV', address: '0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf', decimals: 18 },
      { symbol: 'WBTC', address: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', decimals: 8 },
      { symbol: 'wstETH', address: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', decimals: 18 },
      { symbol: 'XDP', address: '0x07b3D902783c3C12b077508c3B5c00113d1291D0', decimals: 18 },
      { symbol: 'XSGD', address: '0x0A4C9cb2778aB3302996A34BeFCF9a8Bc288C33b', decimals: 6 },
      { symbol: 'YFI', address: '0x9EaF8C1E34F05a589EDa6BAfdF391Cf6Ad3CB239', decimals: 18 },
      { symbol: 'ZCHF', address: '0xD4dD9e2F021BB459D5A5f6c24C12fE09c5D45553', decimals: 18 },
      { symbol: 'ZEN', address: '0xf43eB8De897Fbc7F2502483B2Bef7Bb9EA179229', decimals: 18 },
      { symbol: 'ZORA', address: '0x1111111111166b7FE7bd91427724B487980aFc69', decimals: 18 },
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
      // Added 2026-11-24 at the owner's request, read on Monad (symbol, name, decimals, code). The four wrapped xStocks
      // are not on Monad's official token list (the 2026-11-17 screen left them out for that reason); the owner chose to list them.
      { symbol: 'CHOG', address: '0x350035555E10d9AfAF1566AaebfCeD5BA6C27777', decimals: 18 },
      { symbol: 'wNVDAx', address: '0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5', decimals: 18 }, // Wrapped NVIDIA xStock
      { symbol: 'wTSLAx', address: '0xc3FdBe3A68EE5dE461D30415a8165cf9Aefe1171', decimals: 18 }, // Wrapped Tesla xStock
      { symbol: 'wMUx', address: '0xe2047ee3bdDb5C99ae428AB83df63f8730698e30', decimals: 18 }, // Wrapped Micron xStock
      { symbol: 'wSPYx', address: '0xE7E553Cd128F0011777323A0b44a7b96EA1CB540', decimals: 18 }, // Wrapped SP500 xStock
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
      // Added 2026-11-17 from the owner's Uniswap/SushiSwap token list: read on Optimism and priced through KyberSwap from
      // ETH (under 0.5% loss at about $20, 0.25% at about $200).
      { symbol: 'USDC.e', address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', decimals: 6 }, // bridged USDC; its on-chain symbol is plain "USDC"
      { symbol: 'wstETH', address: '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb', decimals: 18 },
      { symbol: 'rETH', address: '0x9Bcef72be871e61ED4fBbc7630889beE758eb81D', decimals: 18 },
      { symbol: 'USX', address: '0xbfD291DA8A403DAAF7e5E9DC1ec0aCEaCd4848B9', decimals: 18 },
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
      // Second batch from the same list, same checks (2026-11-17).
      { symbol: 'XVS', address: '0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63', decimals: 18 },
      { symbol: 'RHEA', address: '0x4c067DE26475E1CeFee8b8d1f6E2266b33a2372E', decimals: 18 },
      { symbol: 'SPACE', address: '0x87acFA3fD7A6e0d48677D070644D76905C2bDC00', decimals: 18 },
      { symbol: 'UP', address: '0x000008D2175F9AEAdDb2430c26f8A6f73c5A0000', decimals: 18 }, // listed as UNITAS in the token list; UP is its on-chain symbol
      { symbol: '$BANANA', address: '0x3d4f0513E8a29669B960f9dBcA61861548A9A760', decimals: 18 },
      { symbol: 'COLLECT', address: '0x4B3D30992f003c8167699735F5Ab2831B2A087D3', decimals: 18 },
      { symbol: 'mubarak', address: '0x5C85D6C6825aB4032337F11Ee92a72DF936b46F6', decimals: 18 },
      { symbol: 'TAG', address: '0x208bF3E7dA9639f1Eaefa2DE78c23396B0682025', decimals: 18 },
      { symbol: 'BANK', address: '0x3AeE7602b612de36088F3ffEd8c8f10E86EbF2bF', decimals: 18 },
      // Added 2026-11-24 at the owner's request, read on BNB Chain. FLOKI and BabyDoge have 9 decimals.
      { symbol: 'TWT', address: '0x4B0F1812e5Df2A09796481Ff14017e6005508003', decimals: 18 }, // Trust Wallet
      { symbol: 'FLOKI', address: '0xfb5B838b6cfEEdC2873aB27866079AC55363D37E', decimals: 9 },
      { symbol: 'BabyDoge', address: '0xc748673057861a797275CD8A068AbB95A902e8de', decimals: 9 }, // Baby Doge Coin
      { symbol: 'THE', address: '0xF4C8E32EaDEC4BFe97E0F595AdD0f4450a863a11', decimals: 18 }, // THENA
      { symbol: 'LISTA', address: '0xFceB31A79F71AC9CBDCF853519c1b12D379EdC46', decimals: 18 }, // Lista DAO
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
      { symbol: 'XAUt0', address: '0x2775d5105276781B4b85bA6eA6a6653bEeD1dd32', decimals: 6 }, // Tether Gold (bridged); from the owner's token list, same checks
      // Added 2026-11-24 at the owner's request, read on Avalanche C-Chain (symbol, name, decimals, code).
      { symbol: 'JOE', address: '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd', decimals: 18 }, // Trader Joe
      { symbol: 'COQ', address: '0x420FcA0121DC28039145009570975747295f2329', decimals: 18 }, // Coq Inu
      { symbol: 'PNG', address: '0x60781C2586D68229fde47564546784ab3fACA982', decimals: 18 }, // Pangolin
      { symbol: 'QI', address: '0x8729438EB15e2C8B576fCc6AeCdA6A148776C0F5', decimals: 18 }, // BENQI
      // GHO (0xfc421aD3C883Bf9E7C4f42dE845C4e4405799e73) is real here but had no KyberSwap route from AVAX (twice,
      // 2026-11-24; about 82k GHO exist on Avalanche), so it is left out until it can be swapped.
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
