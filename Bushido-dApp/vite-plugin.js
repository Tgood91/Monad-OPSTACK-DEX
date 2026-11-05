// Vite plugin: publishes the Bushido-dApp files with the build.
//   Bushido-dApp/sw.js                -> dist/sw.js   (root, so it can control the whole app)
//   Bushido-dApp/manifest.webmanifest -> dist/Bushido-dApp/manifest.webmanifest
//   Bushido-dApp/icons/*              -> dist/Bushido-dApp/icons/*
// In dev, Vite already serves the folder; this only adds /sw.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default function bushidoDapp() {
  let outDir = 'dist';
  return {
    name: 'bushido-dapp',
    configResolved(cfg) { outDir = path.resolve(cfg.root, cfg.build.outDir); },
    configureServer(server) {
      server.middlewares.use('/sw.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(fs.readFileSync(path.join(HERE, 'sw.js')));
      });
    },
    closeBundle() {
      const dest = path.join(outDir, 'Bushido-dApp');
      fs.mkdirSync(path.join(dest, 'icons'), { recursive: true });
      fs.copyFileSync(path.join(HERE, 'sw.js'), path.join(outDir, 'sw.js'));
      fs.copyFileSync(path.join(HERE, 'manifest.webmanifest'), path.join(dest, 'manifest.webmanifest'));
      for (const f of fs.readdirSync(path.join(HERE, 'icons'))) {
        fs.copyFileSync(path.join(HERE, 'icons', f), path.join(dest, 'icons', f));
      }
    },
  };
}
