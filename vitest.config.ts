import { defineConfig } from 'vitest/config';

// The modules under test are deliberately dependency-free and platform
// agnostic. crypto.subtle and fetch exist in both Node 24 and Workers, so the
// collector's logic runs as plain fast unit tests with no Worker harness. The
// Worker itself is exercised through `wrangler dev --test-scheduled`.
//
// test/live/ is excluded because it makes real requests to real Fediverse
// servers. Run it deliberately with `npm run probe` when you want to see what
// the collector would actually pull today.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/live/**', 'node_modules/**'],
  },
});
