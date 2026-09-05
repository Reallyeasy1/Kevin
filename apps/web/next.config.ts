import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
