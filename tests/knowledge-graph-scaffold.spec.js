// tests/knowledge-graph-scaffold.spec.js
// TASK-035 — Fast-tier scaffold pins for the knowledge graph.
//
// AC9  — knowledge/graph/schema.json exists and is draft-2020-12 with the locked
//         node/edge shapes (ajv-compile it to confirm it is valid + strict).
// AC10 — The committed knowledge/graph/graph.json exists, validates against the
//         schema, and contains nodes for both existing knowledge/entries/*.md files
//         (the seed requirement — "AC self-application").
// AC11 — researcher.md (both copies) mentions the graph lookup in the pre-web KB
//         pass; orchestrator-routing SKILL.md (both copies) mentions recording
//         decision→task edges at close.  Section-scoped matches.
//
// TESTS-FIRST FAILURE SURFACE:
//   AC9  → knowledge/graph/schema.json does not exist → existsSync returns false.
//   AC10 → knowledge/graph/graph.json does not exist → existsSync returns false.
//   AC11 → neither researcher.md nor the skill file contains the required prose
//           → pattern.test() returns false.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import addDraft2020 from 'ajv/dist/2020.js';

import { REPO_ROOT } from './helpers/repoRoot.js';

const GRAPH_DIR = join(REPO_ROOT, 'knowledge', 'graph');
const GRAPH_SCHEMA_PATH = join(GRAPH_DIR, 'schema.json');
const GRAPH_JSON_PATH = join(GRAPH_DIR, 'graph.json');
const ENTRIES_DIR = join(REPO_ROOT, 'knowledge', 'entries');

// Parity-copy paths: canonical (.claude/agents/) and plugin-installed (agents/).
const RESEARCHER_PATHS = [
  join(REPO_ROOT, '.claude', 'agents', 'researcher.md'),
  join(REPO_ROOT, 'agents', 'researcher.md'),
];
// Parity-copy paths for orchestrator-routing skill.
const ORCHESTRATOR_SKILL_PATHS = [
  join(REPO_ROOT, '.claude', 'skills', 'orchestrator-routing', 'SKILL.md'),
  join(REPO_ROOT, 'skills', 'orchestrator-routing', 'SKILL.md'),
];

function readJson(path) {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ===========================================================================
// AC9 — knowledge/graph/schema.json: draft-2020-12, strict, correct shapes.
// ===========================================================================
describe('TASK-035 AC9 — knowledge/graph/schema.json: exists, draft-2020-12, correct shapes', () => {
  it('graph_schema_file_exists', () => {
    expect(existsSync(GRAPH_SCHEMA_PATH), 'knowledge/graph/schema.json must exist').toBe(true);
  });

  it('graph_schema_is_draft_2020_12', () => {
    const schema = readJson(GRAPH_SCHEMA_PATH);
    expect(
      schema.$schema,
      'schema must declare $schema draft-2020-12',
    ).toMatch(/2020-12/);
  });

  it('graph_schema_compiles_cleanly_with_ajv_draft_2020', () => {
    const schema = readJson(GRAPH_SCHEMA_PATH);
    const ajv = new addDraft2020({ allErrors: true });
    addFormats(ajv);
    // compile() throws if the schema is structurally invalid.
    expect(() => ajv.compile(schema), 'schema must compile without ajv errors').not.toThrow();
  });

  it('graph_schema_has_additionalProperties_false_on_node_and_edge', () => {
    const schema = readJson(GRAPH_SCHEMA_PATH);
    // We expect either: a top-level graph schema with $defs for node/edge, or
    // inline definitions. Accept both shapes: look for additionalProperties:false
    // somewhere in the node definition.
    const raw = JSON.stringify(schema);
    expect(
      raw.includes('"additionalProperties":false'),
      'schema must use additionalProperties:false on node and/or edge definitions',
    ).toBe(true);
  });

  it('graph_schema_node_type_enum_has_all_four_locked_types', () => {
    const schema = readJson(GRAPH_SCHEMA_PATH);
    const raw = JSON.stringify(schema);
    const REQUIRED_TYPES = ['knowledge_entry', 'task', 'decision', 'skill'];
    for (const t of REQUIRED_TYPES) {
      expect(
        raw.includes(`"${t}"`),
        `schema must include node type "${t}" in the enum`,
      ).toBe(true);
    }
  });

  it('graph_schema_edge_relation_enum_has_all_locked_relations', () => {
    const schema = readJson(GRAPH_SCHEMA_PATH);
    const raw = JSON.stringify(schema);
    const REQUIRED_RELATIONS = ['learned-in', 'blocks', 'supersedes', 'uses', 'produced-by', 'relates-to'];
    for (const r of REQUIRED_RELATIONS) {
      expect(
        raw.includes(`"${r}"`),
        `schema must include relation "${r}" in the enum`,
      ).toBe(true);
    }
  });

  it('graph_schema_validates_a_correct_empty_graph_document', () => {
    const schema = readJson(GRAPH_SCHEMA_PATH);
    const ajv = new addDraft2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const emptyGraph = { schema_version: 1, nodes: [], edges: [] };
    const ok = validate(emptyGraph);
    expect(ok, `valid empty graph must pass schema: ${JSON.stringify(validate.errors)}`).toBe(true);
  });

  it('graph_schema_rejects_a_node_with_invalid_type', () => {
    const schema = readJson(GRAPH_SCHEMA_PATH);
    const ajv = new addDraft2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const badGraph = {
      schema_version: 1,
      nodes: [{ id: 'x', type: 'not-a-real-type', ref: 'knowledge/entries/x.md', label: 'X' }],
      edges: [],
    };
    expect(validate(badGraph), 'graph with invalid node type must fail schema validation').toBe(false);
  });

  it('graph_schema_rejects_an_edge_with_invalid_relation', () => {
    const schema = readJson(GRAPH_SCHEMA_PATH);
    const ajv = new addDraft2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const badGraph = {
      schema_version: 1,
      nodes: [],
      edges: [{ from: 'a', to: 'b', relation: 'not-a-real-relation' }],
    };
    expect(validate(badGraph), 'graph with invalid edge relation must fail schema validation').toBe(false);
  });
});

// ===========================================================================
// AC10 — knowledge/graph/graph.json: exists, validates, contains seed nodes.
// ===========================================================================
describe('TASK-035 AC10 — knowledge/graph/graph.json: exists, valid, contains seed nodes', () => {
  it('graph_json_file_exists', () => {
    expect(existsSync(GRAPH_JSON_PATH), 'knowledge/graph/graph.json must exist').toBe(true);
  });

  it('graph_json_validates_against_graph_schema', () => {
    const schema = readJson(GRAPH_SCHEMA_PATH);
    const graphJson = readJson(GRAPH_JSON_PATH);
    const ajv = new addDraft2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const ok = validate(graphJson);
    expect(ok, `graph.json must pass schema validation: ${JSON.stringify(validate.errors)}`).toBe(true);
  });

  it('graph_json_contains_nodes_for_all_existing_knowledge_entries', () => {
    expect(existsSync(ENTRIES_DIR), 'knowledge/entries/ must exist').toBe(true);
    const entryFiles = readdirSync(ENTRIES_DIR).filter((n) => n.endsWith('.md'));
    expect(
      entryFiles.length,
      'knowledge/entries/ must have at least one entry for the seed check to be meaningful',
    ).toBeGreaterThanOrEqual(1);

    const graphJson = readJson(GRAPH_JSON_PATH);
    const nodeRefs = new Set(graphJson.nodes.map((n) => n.ref));

    for (const fname of entryFiles) {
      const expectedRef = `knowledge/entries/${fname}`;
      expect(
        nodeRefs.has(expectedRef),
        `graph.json must contain a node with ref "${expectedRef}" (seed of existing entries)`,
      ).toBe(true);
    }
  });

  it('graph_json_seed_nodes_have_type_knowledge_entry', () => {
    const graphJson = readJson(GRAPH_JSON_PATH);
    const entryNodes = graphJson.nodes.filter((n) => n.ref && n.ref.startsWith('knowledge/entries/'));
    expect(entryNodes.length, 'at least one knowledge_entry node must be in the seed').toBeGreaterThan(0);
    for (const node of entryNodes) {
      expect(
        node.type,
        `node ${node.id} with ref ${node.ref} must have type knowledge_entry`,
      ).toBe('knowledge_entry');
    }
  });
});

// ===========================================================================
// AC11 — Prose: researcher.md mentions graph lookup; orchestrator skill mentions
//         decision→task edges at close.  Both parity copies must match.
// ===========================================================================
describe('TASK-035 AC11 — Prose: researcher.md graph lookup; orchestrator skill decision→task edges', () => {
  it.each(RESEARCHER_PATHS)(
    'researcher_md_mentions_graph_lookup_in_kb_pass: %s',
    (researcherPath) => {
      expect(existsSync(researcherPath), `${researcherPath} must exist`).toBe(true);
      const text = readFileSync(researcherPath, 'utf8');

      // The KB lookup section must also mention the graph.
      // We look for "graph" within the proximity of the KB lookup heading or the
      // KB pass instructions — a section-scoped match rather than just any mention.
      const kbSectionRe = /knowledge base lookup[\s\S]{0,2000}graph/i;
      expect(
        kbSectionRe.test(text),
        `researcher.md at ${researcherPath} must mention graph lookup within the ` +
          '"Knowledge base lookup" section (proximity match within 2000 chars of the heading)',
      ).toBe(true);
    },
  );

  it.each(ORCHESTRATOR_SKILL_PATHS)(
    'orchestrator_skill_mentions_decision_task_edges_at_close: %s',
    (skillPath) => {
      expect(existsSync(skillPath), `${skillPath} must exist`).toBe(true);
      const text = readFileSync(skillPath, 'utf8');

      // Must mention recording decision→task (or decision-to-task / decision→ticket) edges
      // when a ticket is closed — section-scoped proximity match.
      const edgeRe = /decision[\s\S]{0,500}(task|ticket)[\s\S]{0,200}edge/i;
      expect(
        edgeRe.test(text),
        `orchestrator-routing SKILL.md at ${skillPath} must mention recording decision→task edges ` +
          'at ticket close (proximity match)',
      ).toBe(true);
    },
  );
});

// ===========================================================================
// M3 — /graph HTML in src/task-board.js obeys the same XSS discipline as the
//      board HTML: no template-literal interpolation, innerHTML only used for
//      empty-string clears, textContent + createElement present.
//
// The existing M2 pins (task-board-scaffold.spec.js) find the FIRST <!DOCTYPE html>
// block in the file. The /graph route adds a SECOND HTML block; these pins target
// that second block specifically by finding the SECOND occurrence.
//
// TESTS-FIRST FAILURE SURFACE:
//   src/task-board.js exists but has no second <!DOCTYPE html> block (the /graph
//   route has not been added) → secondStart === -1 → expect(...).toBeGreaterThan(-1) fails.
// ===========================================================================
describe('M3 — /graph HTML in src/task-board.js pins the textContent/createElement XSS discipline', () => {
  const TASK_BOARD_SRC = join(REPO_ROOT, 'src', 'task-board.js');

  function graphHtmlSegment() {
    expect(existsSync(TASK_BOARD_SRC), 'src/task-board.js must exist').toBe(true);
    const src = readFileSync(TASK_BOARD_SRC, 'utf8');
    // Find the SECOND <!DOCTYPE html> block — that is the /graph page.
    const firstStart = src.indexOf('<!DOCTYPE html>');
    expect(firstStart, 'src/task-board.js must embed at least one HTML document').toBeGreaterThan(-1);
    const secondStart = src.indexOf('<!DOCTYPE html>', firstStart + 1);
    expect(
      secondStart,
      'src/task-board.js must embed a SECOND HTML document (the /graph page)',
    ).toBeGreaterThan(-1);
    const endOfSecond = src.indexOf('</html>', secondStart);
    expect(endOfSecond, 'the /graph HTML document must be terminated with </html>').toBeGreaterThan(secondStart);
    return src.slice(secondStart, endOfSecond);
  }

  it('graph_HTML_contains_no_template_literal_interpolation', () => {
    const html = graphHtmlSegment();
    expect(
      html.includes('${'),
      'the /graph served HTML must be a static string — no ${...} interpolation',
    ).toBe(false);
  });

  it('graph_HTML_innerHTML_is_only_ever_the_empty_string_clear', () => {
    const html = graphHtmlSegment();
    const assignments = html.match(/\.innerHTML\s*=\s*[^;\n]+/g) || [];
    // Only check if there ARE innerHTML assignments — if the impl uses no innerHTML at all,
    // that is fine too (it could use only createElement). Only fail if an unsafe assignment exists.
    for (const a of assignments) {
      expect(
        /\.innerHTML\s*=\s*(''|"")\s*$/.test(a),
        `innerHTML may only be assigned the empty-string clear in the /graph page, found: ${a}`,
      ).toBe(true);
    }
  });

  it('graph_HTML_uses_textContent_and_createElement_for_dynamic_content', () => {
    const html = graphHtmlSegment();
    // At least one of these two XSS-safe patterns must appear in the graph page.
    const hasTextContent = /\.textContent\s*=/.test(html);
    const hasCreateElement = /document\.createElement\(/.test(html);
    expect(
      hasTextContent || hasCreateElement,
      'the /graph page must use textContent or document.createElement for dynamic content (XSS discipline)',
    ).toBe(true);
  });
});

// ===========================================================================
// REVIEW FIX (HIGH-2) — knowledge/README.md documents the graph model and the
// index-not-copy principle. Authorized by the TASK-035 review verdict.
// ===========================================================================
describe('TASK-035 review — knowledge/README.md documents the graph model', () => {
  const KNOWLEDGE_README = join(REPO_ROOT, 'knowledge', 'README.md');

  it('readme_has_graph_section_with_model', () => {
    expect(existsSync(KNOWLEDGE_README), 'knowledge/README.md must exist').toBe(true);
    const text = readFileSync(KNOWLEDGE_README, 'utf8');
    // A graph section that mentions the four node types within proximity.
    const modelRe = /graph[\s\S]{0,3000}knowledge_entry[\s\S]{0,500}decision[\s\S]{0,500}skill/i;
    expect(
      modelRe.test(text),
      'README must document the graph model (node types) within a graph section',
    ).toBe(true);
  });

  it('readme_states_the_index_not_copy_principle', () => {
    const text = readFileSync(KNOWLEDGE_README, 'utf8');
    // The index-not-copy idea must appear in proximity of the graph section:
    // accept the literal "index-not-copy" name or an "index over ... never/not
    // ... copy" phrasing.
    const principleRe = /graph[\s\S]{0,4000}(index[- ]not[- ]copy|index[\s\S]{0,200}(never|not)[\s\S]{0,200}copy)/i;
    expect(
      principleRe.test(text),
      'README must state the index-not-copy principle near the graph section',
    ).toBe(true);
  });
});

// ===========================================================================
// REVIEW FIX (MEDIUM-1) — drift guard: the inline GRAPH_SCHEMA constant in
// src/knowledge-graph.js must stay structurally identical to
// knowledge/graph/schema.json (description annotations excluded).
// Pattern per TASK-033: load both, strip description keys recursively,
// deep-equal. Authorized by the TASK-035 review verdict.
// ===========================================================================
describe('TASK-035 review — inline GRAPH_SCHEMA must not drift from schema.json', () => {
  function stripDescriptions(value) {
    if (Array.isArray(value)) return value.map(stripDescriptions);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === 'description') continue;
        out[k] = stripDescriptions(v);
      }
      return out;
    }
    return value;
  }

  it('inline_schema_deep_equals_schema_json_modulo_descriptions', async () => {
    const fileSchema = JSON.parse(readFileSync(GRAPH_SCHEMA_PATH, 'utf8'));
    const { GRAPH_SCHEMA } = await import('../src/knowledge-graph.js');
    expect(GRAPH_SCHEMA, 'src/knowledge-graph.js must export GRAPH_SCHEMA').toBeDefined();
    expect(
      stripDescriptions(GRAPH_SCHEMA),
      'inline GRAPH_SCHEMA must deep-equal knowledge/graph/schema.json once description annotations are stripped',
    ).toEqual(stripDescriptions(fileSchema));
  });
});
