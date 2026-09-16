import { defineConfig } from 'vitest/config';
import { sharedTest } from './vitest.config.js';

// FULL suite: fast unit tier + the slow tests/e2e/** tier (real disk I/O + process spawns).
// Run via `npm run test:all` (whole suite) or `npm run test:e2e` (slow tier only, by passing
// a `tests/e2e` path filter). Reserved for release/milestone/publish points and for tickets
// touching test infrastructure or tasks/schema.json (see CLAUDE.md's "Which command, when").
// The per-ticket hand-off/review gate is `test:changed`/`test:since` + `npm test` (fast tier)
// only — the named affected tests/e2e/** specs are NOT run here at hand-off; they execute
// later, at the wargaming step (2026-09-16 human decision, WG-H-017), once the adversarial
// pass has said what to attack. `npm test` (vitest.config.js) stays fast for the inner loop
// and deploy smoke.
export default defineConfig({
  test: {
    ...sharedTest,
    include: ['tests/**/*.spec.js'],
  },
});
