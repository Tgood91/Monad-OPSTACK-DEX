// Shared contract ABIs (minimal fragments actually used by the app).

export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

export const WETH_ABI = [
  ...ERC20_ABI,
  'function deposit() payable',
  'function withdraw(uint256 amount)',
];

// Velodrome Slipstream (concentrated liquidity)
export const VELO_CL_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 tickSpacing) view returns (address)',
];
export const VELO_CL_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, int24 tickSpacing, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)',
];
export const VELO_CL_ROUTER_ABI = [
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, int24 tickSpacing, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
];

// Velodrome v2 (Solidly-style stable/volatile)
export const VELO_V2_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, bool stable) view returns (address)',
];
export const VELO_V2_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, tuple(address from, address to, bool stable)[] routes) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple(address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, tuple(address from, address to, bool stable)[] routes, address to, uint256 deadline) payable returns (uint256[] amounts)',
];

// Multicall3 — for batching read calls (balances, allowances)
export const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)',
];

export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'; // same on all chains
