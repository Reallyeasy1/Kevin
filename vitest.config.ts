import { defineConfig } from 'vitest/config';

// ponytail: vitest 4 dropped vitest.workspace.*; one root config with include globs covers every package.
export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'tests/{unit,integration}/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**', 'tests/e2e/**'],
    passWithNoTests: true,
  },
});
