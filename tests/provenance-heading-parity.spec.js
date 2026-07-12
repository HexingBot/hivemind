// tests/provenance-heading-parity.spec.js
// TASK-149 — fast-follow from the TASK-142 fix-round review: PROVENANCE_HEADING
// ('## Sources & provenance (hivemind)') used to exist as three INDEPENDENT
// string-literal copies across src/pack-apply.js (also the hashing anchor for
// canonicalizeSkillTextForContentHash's content_integrity exclusion),
// src/assimilate.js, and src/pack-reconcile.js. If those copies ever drifted,
// canonicalizeSkillTextForContentHash would silently find no heading, skip
// canonicalization, and every untampered skill would false-mismatch at
// reconcile (fail-closed but WRONG — legit installs would break).
//
// ROUTE (a) chosen over route (b): src/pack-apply.js has no import edge FROM
// src/assimilate.js or src/pack-reconcile.js (assimilate.js already imports
// hashDir/hashOwnedSkillDir from pack-apply.js; pack-reconcile.js imports
// nothing from either sibling), so pack-apply.js is a cycle-safe shared home.
// PROVENANCE_HEADING is now exported once from pack-apply.js and imported by
// the other two — this sensor is the guard that the single-source-of-truth
// shape holds: it fails if either importer ever regains its own independent
// literal copy of the heading string (byte-equality drift becomes structurally
// impossible once there is only one declaration to drift from).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './helpers/repoRoot.js';
import { PROVENANCE_HEADING } from '../src/pack-apply.js';

const OWNER_PATH = join(REPO_ROOT, 'src', 'pack-apply.js');
const IMPORTER_PATHS = [
  join(REPO_ROOT, 'src', 'assimilate.js'),
  join(REPO_ROOT, 'src', 'pack-reconcile.js'),
];

// Matches a bare `const PROVENANCE_HEADING = '...'` declaration (with or
// without a leading `export`) — the shape of an independent duplicate copy,
// as opposed to importing the name from another module.
const OWN_DECLARATION_RE = /^(export\s+)?const PROVENANCE_HEADING\s*=\s*'.*'\s*;/m;
const IMPORT_FROM_PACK_APPLY_RE = /import\s*\{[^}]*\bPROVENANCE_HEADING\b[^}]*\}\s*from\s*'\.\/pack-apply\.js'/;

describe('TASK-149 — PROVENANCE_HEADING single-source-of-truth guard', () => {
  it('the exported runtime value is still the exact, unchanged heading string', () => {
    // Value must never change (would break existing on-disk provenance
    // blocks and the content_integrity hashing anchor).
    expect(PROVENANCE_HEADING).toBe('## Sources & provenance (hivemind)');
  });

  it('src/pack-apply.js is the sole declaring owner', () => {
    const text = readFileSync(OWNER_PATH, 'utf8');
    expect(OWN_DECLARATION_RE.test(text)).toBe(true);
  });

  it.each(IMPORTER_PATHS)('%s imports PROVENANCE_HEADING from pack-apply.js instead of declaring its own copy', (path) => {
    const text = readFileSync(path, 'utf8');
    expect(
      IMPORT_FROM_PACK_APPLY_RE.test(text),
      `${path} must import PROVENANCE_HEADING from './pack-apply.js'`,
    ).toBe(true);
    expect(
      OWN_DECLARATION_RE.test(text),
      `${path} must NOT re-declare its own independent PROVENANCE_HEADING literal`,
    ).toBe(false);
  });
});
