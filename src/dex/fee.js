// Bushido integrator / referral fee — frontend copy.
//
// Every DEX source in this app that supports an integrator/referral fee
// (Velora, KyberSwap, and the server-proxied 0x + 1inch) pays it to ONE
// wallet: Tanner's. This file is the single place to change it.
//
// FEE_BPS is in basis points: 25 = 0.25%. Set FEE_BPS to 0 to disable the
// fee in the frontend sources. The server sources read FEE_RECIPIENT /
// FEE_BPS from the server env instead (see server/fee.js) — keep the two
// defaults in sync.

export const FEE_RECIPIENT = '0xBA397fAae1D5Fe10C0356f2e585bef34577ab111';
export const FEE_BPS = 25;

export const FEE_ENABLED =
  FEE_BPS > 0 && /^0x[0-9a-fA-F]{40}$/.test(FEE_RECIPIENT);
