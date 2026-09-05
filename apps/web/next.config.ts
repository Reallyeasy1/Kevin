import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // next dev holds a lock under <distDir>/dev; a second dev server (Playwright on WEB_PORT while a manual
  // server runs) needs its own distDir. Default stays .next.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Workspace packages are shipped as TS source (exports ./src/index.ts).
  transpilePackages: ['@subbuddy/contracts'],
  // contracts uses NodeNext-style `./state-machine.js` specifiers for .ts sources. Turbopack cannot map
  // .js -> .ts (resolveAlias only handles bare specifiers), so apps/web runs on webpack (`--webpack` in the
  // scripts) with extensionAlias, the documented fix for this pattern.
  webpack: (config) => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default nextConfig;
