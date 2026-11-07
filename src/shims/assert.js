// Browser replacement for Node's built-in `assert`, which @1inch/fusion-sdk,
// @1inch/limit-order-sdk and @1inch/byte-utils import (see the alias in vite.config.js).
// Vite otherwise swaps in an empty stub, and the SDK would crash the first time it
// validates an order. The SDK only ever calls assert(condition, message).
export default function assert(value, message) {
  if (!value) throw message instanceof Error ? message : new Error(message ?? 'Assertion failed');
}
