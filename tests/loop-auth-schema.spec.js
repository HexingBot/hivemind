// tests/loop-auth-schema.spec.js
// TASK-075 AC4 — auto_consolidate must be added to the loop_auth schema in
// BOTH copies (src/schemas.js and state/bundle.schema.json), and the two
// loop_auth definitions must stay structurally identical forever (parity
// spec). This is a permanent drift guard, not a one-shot check.
//
// Today (before IMPL) both copies define only 4 switches — this file MUST
// FAIL until src/schemas.js and state/bundle.schema.json both gain
// auto_consolidate.
//
// Pure schema-shape assertions; no disk I/O beyond reading committed files.
// Fast tier (tests/*.spec.js).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { bundleStateSchema } from '../src/schemas.js';

function loadJsonBundleSchema() {
  const p = join(REPO_ROOT, 'state', 'bundle.schema.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

// Structural fingerprint of a loop_auth property definition: property names
// (sorted), each property's `type`, each property's `default`, and the
// container's `additionalProperties` flag. Deliberately ignores `description`
// text so the two copies can carry independently-worded docs without
// tripping the parity guard.
function fingerprintLoopAuth(loopAuthSchema) {
  const props = loopAuthSchema.properties || {};
  const names = Object.keys(props).sort();
  return {
    additionalProperties: loopAuthSchema.additionalProperties,
    properties: names.map((name) => ({
      name,
      type: props[name].type,
      default: props[name].default,
    })),
  };
}

describe('AC4 — src/schemas.js loop_auth includes auto_consolidate', () => {
  it('bundleStateSchema.properties.loop_auth.properties.auto_consolidate is a boolean defaulting false', () => {
    const prop = bundleStateSchema.properties.loop_auth.properties.auto_consolidate;
    expect(prop, 'auto_consolidate must be defined on src/schemas.js loop_auth').toBeDefined();
    expect(prop.type).toBe('boolean');
    expect(prop.default).toBe(false);
  });

  it('additionalProperties stays false on src/schemas.js loop_auth (no silent field creep)', () => {
    expect(bundleStateSchema.properties.loop_auth.additionalProperties).toBe(false);
  });
});

describe('AC4 — state/bundle.schema.json loop_auth includes auto_consolidate', () => {
  it('loop_auth.properties.auto_consolidate is a boolean defaulting false', () => {
    const schema = loadJsonBundleSchema();
    const prop = schema.properties.loop_auth.properties.auto_consolidate;
    expect(prop, 'auto_consolidate must be defined on state/bundle.schema.json loop_auth').toBeDefined();
    expect(prop.type).toBe('boolean');
    expect(prop.default).toBe(false);
  });

  it('additionalProperties stays false on state/bundle.schema.json loop_auth', () => {
    const schema = loadJsonBundleSchema();
    expect(schema.properties.loop_auth.additionalProperties).toBe(false);
  });
});

describe('AC4 — parity: src/schemas.js and state/bundle.schema.json loop_auth stay structurally identical', () => {
  it('the two loop_auth definitions fingerprint identically (property names, types, defaults, additionalProperties)', () => {
    const jsFingerprint = fingerprintLoopAuth(bundleStateSchema.properties.loop_auth);
    const jsonFingerprint = fingerprintLoopAuth(loadJsonBundleSchema().properties.loop_auth);
    expect(jsFingerprint).toEqual(jsonFingerprint);
  });

  it('both copies expose exactly the five loop_auth switches', () => {
    const expected = [
      'auto_close_on_green_review',
      'auto_consolidate',
      'auto_push_after_close',
      'auto_version_bump_on_milestone',
      'uat_delegated_to_orchestrator',
    ].sort();

    const jsNames = Object.keys(bundleStateSchema.properties.loop_auth.properties).sort();
    const jsonNames = Object.keys(loadJsonBundleSchema().properties.loop_auth.properties).sort();

    expect(jsNames).toEqual(expected);
    expect(jsonNames).toEqual(expected);
  });
});
