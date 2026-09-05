import { defineConfig } from 'vitest/config';

// ponytail: vitest 4 dropped vitest.workspace.*; one root config with include globs covers every package.
export default defineConfig({
  // apps/web sets jsx: preserve for Next; vitest needs real JSX output for component tests.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'tests/{unit,integration,acceptance}/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**', 'tests/e2e/**'],
    passWithNoTests: true,
  },
});
