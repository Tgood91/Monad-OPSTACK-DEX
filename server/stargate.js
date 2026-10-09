// Stargate V2 bridging (keyless, on-chain).
// Flow: quoteOFT -> quoteSend (both view calls via RPC) -> user approves token
// -> user calls sendToken{value} on the pool. Server never signs or holds funds.
// Docs: https://stargateprotocol.gitbook.io/stargate/v2-developer-docs
// Note: Stargate V2 = same-asset bridging only (USDC -> USDC, etc.).
// Monad routes go through Hydra and are NOT covered here; NEAR Intents covers Monad.

import { ethers } from "ethers";

// LayerZero endpoint IDs
const EIDS = {
  1: 30101,    // Ethereum
  8453: 30184, // Base
  10: 30111,   // Optimism
  42161: 30110, // Arbitrum
  43114: 30106, // Avalanche
  56: 30102,   // BNB Chain
};

export const STARGATE_CHAINS = Object.keys(EIDS).map(Number);

// Stargate V2 pool contracts (from official docs) + underlying tokens.
// token() on each pool returns the underlying ERC-20; address(0) = native.
const POOLS = {
  1: { // Ethereum
    USDC: { pool: "0xc026395860Db2d07ee33e05fE50ed7bD583189C7", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    USDT: { pool: "0x933597a323Eb81cAe705C5bC29985172fd5A3973", token: "0xdAC17F958D2ee523a2206206994597c13D831ec7" },
    NATIVE: { pool: "0x77b2043768d28E9C9aB44E1aBfC95944bcE57931", token: null },
  },
  8453: { // Base
    USDC: { pool: "0x27a16dc786820B16E5c9028b75B99F6f604b5d26", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    NATIVE: { pool: "0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7", token: null },
  },
  10: { // Optimism
    USDC: { pool: "0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0", token: "0x0b2c639c533813f4aa9d7837CAF62653d097Ff85" },
    USDT: { pool: "0x19cFCE47eD54a88614648DC3f19A5980097007dD", token: "0x94b008aA00579c1307B0Ef2c499Ad98a8Ce58e58" },
    NATIVE: { pool: "0xe8CDF27AcD73a434D661C84887215F7598e7d0d3", token: null },
  },
  42161: { // Arbitrum
    USDC: { pool: "0xe8CDF27AcD73a434D661C84887215F7598e7d0d3", token: "0xaf88d065E77c8cC2239327C5dB5A432268e5831" },
    USDT: { pool: "0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0", token: "0xFd086bC7CD5C481DCC9c85eBe478A1C0B69FCbb" },
    NATIVE: { pool: "0xA45B5130f36CDcA45667738e2a258AB09f4A5f7F", token: null },
  },
  43114: { // Avalanche
    USDC: { pool: "0x5634c4a5FEd09819E3c46D86A965Dd9447d86e47", token: "0xB97EF9Ef8734C71904d8002f8b6Bc66Dd9c48a6E" },
    USDT: { pool: "0x12dC9256Acc9895B076f6638D628382881e62CeE", token: "0x9702230A8a47E5c5810F8fFfE72Cc03A2F7a59a4Bb" },
  },
  56: { // BNB Chain
    USDC: { pool: "0x962Bd449E630b0d928f308Ce63f1A21F02576057", token: "0x8AC76a51C950d982fF0a94163b2e68F9E4b8d8c6" },
    USDT: { pool: "0x138EB30f73BC423c6455C53df6D89CB01d9eBc63", token: "0x55d398326f99059fF775485246999027B3197955" },
  },
};

// Public RPCs for quote view-calls (keyless)
const RPCS = {
  1: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
  8453: ["https://mainnet.base.org", "https://base.drpc.org"],
  10: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
  42161: ["https://arbitrum-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
  43114: ["https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc"],
  56: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"],
};

const STARGATE_ABI = [
  "function token() view returns (address)",
  "function quoteOFT((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd)) view returns (uint256 minAmountLD, uint256 maxAmountLD, (uint256 amountSentLD, uint256 amountReceivedLD))",
  "function quoteSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd), bool payInLzToken) view returns (uint256 nativeFee, uint256 lzTokenFee)",
  "function sendToken((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd), (uint256 nativeFee, uint256 lzTokenFee), address refundAddress) payable returns ((bytes32 guid, uint64 nonce, (uint256 nativeFee, uint256 lzTokenFee) fee), (uint256 amountSentLD, uint256 amountReceivedLD), (uint56 ticketId, bytes passenger))",
];

async function withRpc(chainId, fn) {
  const urls = RPCS[chainId] || [];
  let lastErr = null;
  for (const url of urls) {
    try {
      const provider = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true });
      const out = await Promise.race([
        fn(provider),
        new Promise((_, rej) => setTimeout(() => rej(new Error("rpc timeout")), 12000)),
      ]);
      provider.destroy?.();
      return out;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("no RPC available");
}

function addrToBytes32(addr) {
  return ethers.zeroPadValue(ethers.getAddress(addr), 32);
}

/** Resolve (chainId, 'native'|'USDC'|'USDT'|0x…) -> { pool, token, symbol, decimals } */
export function resolvePool(chainId, tokenRef) {
  const pools = POOLS[Number(chainId)];
  if (!pools) return null;
  const ref = String(tokenRef || "").toUpperCase();
  let key = null;
  if (ref === "NATIVE") key = "NATIVE";
  else if (ref === "USDC") key = "USDC";
  else if (ref === "USDT") key = "USDT";
  else return null; // Stargate V2 = same-asset only; unknown tokens unsupported
  const entry = pools[key];
  if (!entry) return null;
  return { pool: entry.pool, token: entry.token, symbol: key === "NATIVE" ? "native" : key, key,
           decimals: key === "NATIVE" ? 18 : 6 };
}

/** Tokens Stargate can bridge FROM a chain (pool-backed). */
export function stargateTokens(chainId) {
  const pools = POOLS[Number(chainId)];
  if (!pools) return [];
  const out = [];
  if (pools.USDC) out.push({ symbol: "USDC", ref: "USDC", address: pools.USDC.token, decimals: 6 });
  if (pools.USDT) out.push({ symbol: "USDT", ref: "USDT", address: pools.USDT.token, decimals: 6 });
  if (pools.NATIVE) out.push({ symbol: "native", ref: "NATIVE", address: null, decimals: 18 });
  return out;
}

/**
 * Quote a Stargate bridge: { fromChainId, toChainId, tokenRef ('NATIVE'|'USDC'|'USDT'),
 * amountAtomic (string), recipient (0x…) }.
 * Returns { pool, token, tokenDecimals, amountReceived, nativeFee, sendParam, messagingFee }.
 * The USER's wallet then: approve(token -> pool) if ERC-20, then
 * sendToken{value: nativeFee (+amount if native)}(sendParam, messagingFee, refundAddress).
 */
export async function stargateQuote({ fromChainId, toChainId, tokenRef, amountAtomic, recipient }) {
  fromChainId = Number(fromChainId); toChainId = Number(toChainId);
  const dstEid = EIDS[toChainId];
  if (!dstEid) throw new Error("destination chain not supported by Stargate");
  const r = resolvePool(fromChainId, tokenRef);
  if (!r) throw new Error("token not supported by Stargate on source chain");
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) throw new Error("bad recipient");
  const amount = BigInt(amountAtomic);

  return withRpc(fromChainId, async (provider) => {
    const pool = new ethers.Contract(r.pool, STARGATE_ABI, provider);
    const tokenAddr = await pool.token();
    const isNative = tokenAddr === ethers.ZeroAddress;

    const sendParam = {
      dstEid,
      to: addrToBytes32(recipient),
      amountLD: amount,
      minAmountLD: 0n,
      extraOptions: "0x",
      composeMsg: "0x",
      oftCmd: "0x", // taxi mode = immediate
    };
    const [, , oftReceipt] = await pool.quoteOFT(sendParam);
    sendParam.minAmountLD = oftReceipt.amountReceivedLD;
    const [nativeFee, lzTokenFee] = await pool.quoteSend(sendParam, false);

    // valueToSend = messaging fee (+ amount if native token)
    let valueToSend = nativeFee;
    if (isNative) valueToSend += amount;

    return {
      pool: r.pool,
      token: tokenAddr,
      isNative,
      symbol: r.symbol,
      dstEid,
      amountReceived: oftReceipt.amountReceivedLD.toString(),
      nativeFee: nativeFee.toString(),
      lzTokenFee: lzTokenFee.toString(),
      valueToSend: valueToSend.toString(),
      sendParam: {
        dstEid,
        to: sendParam.to,
        amountLD: amount.toString(),
        minAmountLD: sendParam.minAmountLD.toString(),
        extraOptions: "0x",
        composeMsg: "0x",
        oftCmd: "0x",
      },
      messagingFee: { nativeFee: nativeFee.toString(), lzTokenFee: lzTokenFee.toString() },
    };
  });
}

/**
 * Build the executable sendToken transaction for the user's wallet.
 * Takes the quote output from stargateQuote(). Returns { to, data, value }.
 */
export function stargateBuildTx(quote, refundAddress) {
  const iface = new ethers.Interface(STARGATE_ABI);
  const sendParam = {
    dstEid: quote.sendParam.dstEid,
    to: quote.sendParam.to,
    amountLD: BigInt(quote.sendParam.amountLD),
    minAmountLD: BigInt(quote.sendParam.minAmountLD),
    extraOptions: "0x",
    composeMsg: "0x",
    oftCmd: "0x",
  };
  const fee = {
    nativeFee: BigInt(quote.messagingFee.nativeFee),
    lzTokenFee: BigInt(quote.messagingFee.lzTokenFee),
  };
  const data = iface.encodeFunctionData("sendToken", [sendParam, fee, refundAddress]);
  return { to: quote.pool, data, value: "0x" + BigInt(quote.valueToSend).toString(16) };
}
