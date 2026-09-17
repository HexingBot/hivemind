// tests/helpers/deliveryBody.js
// TASK-234 (WG-H-001/WG-H-002/WG-H-003) — the ONE place a conforming closing
// comment body is built for tests.
//
// Since TASK-234, `closeTask` rejects a closing comment that does not carry
// docs/PLANTILLA-ENTREGA.md's four numbered blocks with real content
// (DeliveryBodyError). Every spec that closes a ticket therefore needs a
// conforming body; building one inline in each spec would give ~20 subtly
// different copies that drift the moment the template changes, so they all
// come from here instead.
//
// This is a FIXTURE, not a second implementation of the check: it never
// re-encodes the rules (that would be a copy of the guard, tested against
// itself). It is just the delivery a real close writes.

/**
 * A conforming delivery body. Every block can be overridden with raw lines —
 * that is how the negative-path specs build a body that is conforming EXCEPT
 * for the one thing under test.
 *
 * @param {object} [o]
 * @param {string} [o.ticket]     the ticket key in the title line
 * @param {string} [o.cases]      body of block 1
 * @param {string} [o.result]     body of block 2
 * @param {string} [o.wargaming]  body of block 3
 * @param {string} [o.uat]        body of block 4
 */
export function deliveryBody({
  ticket = 'TASK-000',
  cases = '   1. CU1 cierre legitimo con evidencia -> cumplido',
  result = '   - El actor ahora puede cerrar el ticket con la entrega completa.\n'
    + '   - Donde quedo: src/task-store.js\n'
    + '   - Commits: ver linked_commits',
  wargaming = '   - Atacado: CU1 y su path de fallo (cierre sin evidencia)\n'
    + '   - Sobrevivio: el cierre legitimo\n'
    + '   - No sobrevivio: nada\n'
    + '   - E2E corridos aca: tests/e2e/task-store.spec.js -> verde\n'
    + '   - Veredicto: PASS',
  uat = '   - Solicitado: no (fixture de test, sin criterios observables)',
} = {}) {
  return [
    `ENTREGA — ${ticket}`,
    '',
    '1. CASOS DE USO APROBADOS (aprobados por el humano al despachar)',
    cases,
    '',
    '2. RESULTADO',
    result,
    '',
    '3. WARGAMING',
    wargaming,
    '',
    '4. UAT',
    uat,
    '',
    '5. ESTADO Y DEUDAS',
    '   - Ninguna.',
  ].join('\n');
}

/**
 * A conforming `[WARGAMING]` record comment — what `transitionStatus(status:
 * 'done')` requires since TASK-234 (that path carries no comment body, so the
 * marker comment is the only place the wargaming record can live), and what
 * `closeTask` accepts as the alternative to the body's own block 3.
 */
export function wargamingComment(at = '2026-09-16T00:00:00Z') {
  return {
    author: 'orchestrator',
    at,
    body: '[WARGAMING] Atacado: CU1 y su path de fallo. Sobrevivio: todo. Veredicto: PASS.',
  };
}

/** The four headings with nothing under them — WG-H-002's measured shape. */
export const EMPTY_BLOCKS_BODY = [
  'ENTREGA — TASK-000',
  '',
  '1. CASOS DE USO APROBADOS',
  '',
  '2. RESULTADO',
  '',
  '3. WARGAMING',
  '',
  '4. UAT',
  '',
].join('\n');
