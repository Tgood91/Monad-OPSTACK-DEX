// Browsers have no Node `Buffer`, but wallet libraries (Reown AppKit sign-in,
// Ethereum RLP helpers) call it directly, which crashes with "Buffer is not defined"
// when connecting. Provide it globally. Must be the FIRST import in src/main.js.
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;
