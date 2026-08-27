import { defineConfig } from 'vitest/config';

// Live capability probe. Makes real unauthenticated requests to public
// endpoints on real servers, so it is kept out of the default suite and run on
// purpose with `npm run probe`. Instance capability changes without notice, so
// this is the check that keeps docs/probe-*.md honest.
export default defineConfig({
  test: { environment: 'node', include: ['test/live/**/*.test.ts'], testTimeout: 30_000 },
});
