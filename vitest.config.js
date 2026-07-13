import { defineConfig } from 'vitest/config';

// Two test tiers share every runner setting below; only `include` differs.
//  - Default (this file): FAST unit tier — top-level tests/*.spec.js only (~2s
//    test-execution; ~7s wall-clock once process startup and collect are counted —
//    collect scales with spec-file count). Pure logic, no real disk I/O. This is
//    `npm test`: the TDD inner loop and the deploy smoke.
//  - vitest.config.all.js: FULL suite, adds tests/e2e/** (real mkdtemp disk I/O + process
//    spawns). This is `npm run test:all`: the release / milestone / publish gate, and the
//    gate for any ticket that touches test infrastructure or tasks/schema.json.
// Rationale: TDD accumulates hundreds of specs. Running the slow disk/spawn tier on every
// change — and on every deploy — is the bottleneck, not the test count. Splitting the tiers
// keeps the slow disk/spawn tier out of the inner loop and deploy smoke; scoped test
// selection (`npm run test:changed` / `test:since`) is what actually bounds inner-loop
// time to just the affected specs, while the full gate still runs in CI/review.
export const sharedTest = {
  environment: 'node',
  // e2e specs do real disk I/O across tmp dirs; give them headroom on Windows.
  testTimeout: 20_000,
  hookTimeout: 20_000,
  // Several e2e specs mock node:fs globally and churn tmp dirs; serial is calmer under
  // Windows AV / OneDrive sync interaction. Parallel forks measured no net win here.
  pool: 'forks',
  poolOptions: {
    forks: { singleFork: true },
  },
};

export default defineConfig({
  test: {
    ...sharedTest,
    include: ['tests/*.spec.js'],
  },
});
