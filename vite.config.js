import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Dev: forward API calls to the key-holding backend (server/index.js on :3001).
      // In production the same backend serves the built frontend, so /api is same-origin.
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          appkit: ['@reown/appkit', '@reown/appkit-adapter-ethers'],
          ethers: ['ethers'],
        },
      },
    },
  },
});
