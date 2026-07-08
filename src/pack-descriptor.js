// src/pack-descriptor.js
// TASK-115 — Addon-pack descriptor schema + validator (Wave 1 / Phase A,
// docs/design/addon-packs-plan.md §4). Pure data + validation, no I/O and no
// reconciler behavior — that lands in later Phase-A/B tickets.
//
// validatePackDescriptor(obj) checks two layers:
//   1. Pure JSON-schema shape (state/pack-descriptor.schema.json), covering
//      unknown resource.kind/scope, missing required top-level fields, and
//      resource.required outside {hard, soft}.
//   2. Semantic checks ajv cannot express, appended to the same errors array
//      ajv would return:
//      - resource.fallback, when present, must reference ANOTHER resource id
//        declared in the SAME descriptor (addon-packs-plan.md §8's fallback
//        field) — both a dangling fallback and a self-referencing fallback
//        (a resource falling back to itself) are rejected.
//      - resource ids must be unique within a descriptor — a duplicate id is
//        ambiguous for the fallback check above and for any downstream
//        consumer that treats resource.id as a unique key.

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// TASK-023 precedent (src/task-store.js, src/project-md.js) — the schema is
// INLINED via a JSON import rather than read at runtime from an
// import.meta.url-relative path, so esbuild can bundle it into the
// self-contained dist/*.cjs plugin entrypoints. state/pack-descriptor.schema.json
// remains the on-disk source of truth.
import __schema from '../state/pack-descriptor.schema.json' with { type: 'json' };

// ----- ajv compile-once-per-process, mirroring src/task-store.js. -----
const __ajv = new Ajv({ allErrors: true, strict: false });
addFormats(__ajv);
const __validate = __ajv.compile(__schema);

/**
 * Validate a pack descriptor object against state/pack-descriptor.schema.json,
 * plus the fallback-reference semantic check described above.
 *
 * @param {object} obj - candidate pack descriptor.
 * @returns {{ valid: boolean, errors: Array<{ instancePath: string, message: string }>|null }}
 */
export function validatePackDescriptor(obj) {
  const ok = __validate(obj);
  const errors = ok ? [] : [...__validate.errors];

  if (obj && Array.isArray(obj.resources)) {
    const knownIds = new Set(
      obj.resources
        .map((resource) => resource && resource.id)
        .filter((id) => typeof id === 'string'),
    );

    // Duplicate resource ids are ambiguous both for the fallback check below
    // and for any downstream consumer keying off resource.id. Every resource
    // sharing a duplicated id is flagged, not just the second occurrence.
    const idCounts = new Map();
    for (const resource of obj.resources) {
      if (resource && typeof resource.id === 'string') {
        idCounts.set(resource.id, (idCounts.get(resource.id) || 0) + 1);
      }
    }
    obj.resources.forEach((resource, index) => {
      if (resource && typeof resource.id === 'string' && idCounts.get(resource.id) > 1) {
        errors.push({
          instancePath: `/resources/${index}/id`,
          message: `duplicate resource id "${resource.id}" — resource ids must be unique within a descriptor`,
        });
      }
    });

    obj.resources.forEach((resource, index) => {
      if (!resource || typeof resource.fallback !== 'string') return;
      if (resource.fallback === resource.id) {
        errors.push({
          instancePath: `/resources/${index}/fallback`,
          message: `must reference another resource id, not itself (got "${resource.fallback}")`,
        });
      } else if (!knownIds.has(resource.fallback)) {
        errors.push({
          instancePath: `/resources/${index}/fallback`,
          message: `must reference an existing resource id in the same descriptor (got "${resource.fallback}")`,
        });
      }
    });
  }

  return { valid: errors.length === 0, errors: errors.length ? errors : null };
}
