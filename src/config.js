// AppKit (Web3Modal) setup — wallet connection, network switching, sessions.
// Project ID is free at https://cloud.reown.com → put it in .env as VITE_PROJECT_ID.

import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { optimism, base, celo, defineChain } from '@reown/appkit/networks';
import { CHAINS } from './dex/chains.js';

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

const networks = [celo, optimism, ink, base, unichain];

export const appKit = createAppKit({
  adapters: [new EthersAdapter()],
  networks,
  defaultNetwork: celo,
  projectId,
  metadata: {
    name: import.meta.env.VITE_APP_NAME || 'Multi-Chain DEX',
    description: import.meta.env.VITE_APP_DESCRIPTION || 'Best-price DEX across Celo, Optimism, Ink, Base, Unichain',
    url: import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'),
    icons: [import.meta.env.VITE_APP_ICON || 'https://velodrome.finance/favicon.ico'],
  },
  features: {
    analytics: true,
    email: false,
    socials: [],
  },
});

// Map our internal chain key → AppKit network object
const NETWORK_BY_KEY = { celo, optimism, ink, base, unichain };

export function appKitNetworkFor(chainKey) {
  return NETWORK_BY_KEY[chainKey];
}

export function chainKeyForChainId(chainId) {
  return Object.values(CHAINS).find(c => c.chainId === Number(chainId))?.key || null;
}
