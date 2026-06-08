import { defineConfig } from 'vitest/config';
import { sharedTest } from './vitest.config.js';

// FULL suite: fast unit tier + the slow tests/e2e/** tier (real disk I/O + process spawns).
// Run via `npm run test:all` (whole suite) or `npm run test:e2e` (slow tier only, by passing
// a `tests/e2e` path filter). The Developer runs this before hand-off; the Reviewer re-runs
// it from clean. `npm test` (vitest.config.js) stays fast for the inner loop and deploy smoke.
export default defineConfig({
  test: {
    ...sharedTest,
    include: ['tests/**/*.spec.js'],
  },
});
