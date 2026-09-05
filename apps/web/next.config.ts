import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages are shipped as TS source (exports ./src/index.ts).
  transpilePackages: ['@subbuddy/contracts'],
};

export default nextConfig;
