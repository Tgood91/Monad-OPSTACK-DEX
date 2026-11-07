// AppKit (Web3Modal) setup — wallet connection, network switching, sessions.
// Project ID is free at https://cloud.reown.com → put it in .env as VITE_PROJECT_ID.

import { createAppKit } from '@reown/appkit';
import { ReownAuthentication } from '@reown/appkit-siwx';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { base, optimism, defineChain } from '@reown/appkit/networks';
import { CHAINS } from './dex/chains.js';

// Line shown in the wallet's sign-in prompt, between the address and the "URI:" line.
// AppKit's Reown Authentication leaves the SIWE "statement" empty and offers no
// option for it, so we set it on the message it creates.
export const SIGN_IN_STATEMENT = 'Welcome bushido warriors. Enjoy exploring the bushido beta dex.';

export class BushidoAuthentication extends ReownAuthentication {
  async createMessage(input) {
    const msg = await super.createMessage(input);
    // msg.toString() reads this same object, so the text includes the statement.
    msg.statement = SIGN_IN_STATEMENT;
    return msg;
  }
}

const projectId = import.meta.env.VITE_PROJECT_ID || 'YOUR_PROJECT_ID_HERE';

// Custom chains not in AppKit's preset list
const ink = defineChain({
  id: 57073,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc-gel.inkonchain.com'] } },
  blockExplorers: { default: { name: 'Ink Explorer', url: 'https://explorer.inkonchain.com' } },
});

const unichain = defineChain({
  id: 130,
  name: 'Unichain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://unichain.drpc.org'] } },
  blockExplorers: { default: { name: 'Uniscan', url: 'https://uniscan.xyz' } },
});

const monad = defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'Monadscan', url: 'https://monadscan.com' } },
});

const networks = [base, monad, optimism, ink, unichain];

export const appKit = createAppKit({
  adapters: [new EthersAdapter()],
  networks,
  defaultNetwork: base,
  projectId,
  metadata: {
    name: import.meta.env.VITE_APP_NAME || 'Bushido-dApp',
    description: import.meta.env.VITE_APP_DESCRIPTION || 'Best-price DEX across Base, Monad, Optimism, Ink, Unichain',
    url: import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'),
    icons: [import.meta.env.VITE_APP_ICON || 'https://velodrome.finance/favicon.ico'],
  },
  features: {
    analytics: true,
    email: false,
    // Social logins (Reown embedded wallet). Also enabled for this project in Reown Cloud.
    socials: ['google', 'x', 'discord', 'farcaster', 'apple', 'github', 'facebook'],
  },
  // ---- Aave-style modal: dark navy surface, Aave pink->teal accent, rounded,
  // a short list of popular wallets up front, the full list behind "All wallets".
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#B6509E',             // Aave pink (buttons, links, focus)
    '--w3m-color-mix': '#1B2030',          // Aave navy tint over the modal surface
    '--w3m-color-mix-strength': 40,
    '--w3m-border-radius-master': '4px',   // rounder corners, like Aave's modal
    '--w3m-font-family': 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    '--w3m-z-index': 1000,
  },
  // WalletConnect Explorer ids: MetaMask, Coinbase Wallet, Rainbow, Trust, Zerion
  featuredWalletIds: [
    'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',
    'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa',
    '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369',
    '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0',
    'ecc4036f814562b41a5268adc86270fba1365471402006302e70169465b7ac18',
  ],
  allWallets: 'SHOW',
  // Sign-In With X (Reown Authentication): after connecting, the wallet signs a
  // one-time message proving ownership; Reown stores the session. Must be enabled
  // for this project in Reown Cloud. Default required=true: declining the
  // signature disconnects the wallet.
  siwx: new BushidoAuthentication(),
});

// Map our internal chain key → AppKit network object
const NETWORK_BY_KEY = { base, monad, optimism, ink, unichain };

export function appKitNetworkFor(chainKey) {
  return NETWORK_BY_KEY[chainKey];
}

export function chainKeyForChainId(chainId) {
  return Object.values(CHAINS).find(c => c.chainId === Number(chainId))?.key || null;
}
