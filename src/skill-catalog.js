// src/skill-catalog.js
// TASK-053 — Vetted skill catalog for the web console skill-buttons panel.
//
// listSkills({ repoRoot }) → array of { id, label, description, invocation }
//
// The catalog is derived from two sources:
//   1. commands/*.md files shipped with the plugin — each file's frontmatter
//      `description` is read to build an entry. Growing commands/ auto-extends
//      the catalog; no hand-maintained drift-prone list.
//   2. A small curated SAFE-ACTIONS allowlist for non-technical users (e.g. a
//      plain-English "help" prompt). These are always safe, never destructive.
//
// Stable order: commands entries sorted by id (ascending), then curated entries.
//
// resolveSkillInvocation(repoRoot, id) → invocation string | null
//   Returns the full invocation for a known skill id. Returns null for an
//   unknown id. Used by the route to map client-supplied id → canonical command
//   and to reject unknown ids without executing anything.
//
// NO new npm dependencies — the frontmatter is a trivial two-line YAML block
// (key: value) and is parsed with the same minimal regex-based approach used
// by the in-house parser in src/project-md.js (parseFrontmatter).

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { basename } from 'node:path';

// ---------------------------------------------------------------------------
// Curated safe-actions allowlist — always appended after the commands/ entries.
// These entries let non-technical users trigger read-only or helpful operations
// without typing commands. All entries are non-destructive.
// ---------------------------------------------------------------------------
const CURATED_SKILLS = [
  {
    id: 'help',
    label: 'Help',
    description: 'Ask the orchestrator what it can do for you',
    invocation: 'What can you help me with right now? List the actions and tickets available.',
  },
  {
    id: 'status',
    label: 'Status',
    description: 'Get a brief status update on current work in progress',
    invocation: 'Give me a brief status update: what is the current active task, what step are you on, and what is the next action?',
  },
];

// ---------------------------------------------------------------------------
// Internal: derive a human-readable Title Case label from a kebab-case id.
// e.g. "task-status" → "Task Status", "apply-workflows" → "Apply Workflows"
// ---------------------------------------------------------------------------
function deriveLabel(id) {
  return id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Internal: extract the `description` field from a simple YAML frontmatter.
// Only needs to handle `key: value` scalar lines — the commands/*.md files
// use a minimal frontmatter subset (matching what PROJECT.md uses).
// Returns null if no description is found or the file has no frontmatter.
// ---------------------------------------------------------------------------
function extractFrontmatterDescription(text) {
  // Must start with ---
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;

  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return null;

  // Scan frontmatter lines for `description: <value>`
  for (let i = 1; i < closeIdx; i++) {
    const m = lines[i].match(/^description:\s*(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public: listSkills({ repoRoot }) → [{ id, label, description, invocation }]
// ---------------------------------------------------------------------------
export async function listSkills({ repoRoot } = {}) {
  const commandsDir = repoRoot ? join(repoRoot, 'commands') : null;
  const commandSkills = [];

  if (commandsDir && existsSync(commandsDir)) {
    let entries;
    try {
      entries = await readdir(commandsDir);
    } catch {
      entries = [];
    }

    const mdFiles = entries
      .filter((name) => name.endsWith('.md'))
      .sort(); // sort alphabetically → sort by id (filename)

    for (const filename of mdFiles) {
      const id = basename(filename, '.md');
      // Skip if id clashes with a curated entry (curated takes precedence in
      // the curated section; disk entry is still included before it).
      const filePath = join(commandsDir, filename);
      let text;
      try {
        text = await readFile(filePath, 'utf8');
      } catch {
        continue; // unreadable file — skip
      }

      const description = extractFrontmatterDescription(text) || `Run /${id}`;
      const invocation = `/agentic-framework:${id}`;
      const label = deriveLabel(id);

      commandSkills.push({ id, label, description, invocation });
    }
  }

  // Stable order: commands sorted by id (already sorted above), then curated.
  return [...commandSkills, ...CURATED_SKILLS];
}

// ---------------------------------------------------------------------------
// Public: resolveSkillInvocation(repoRoot, id) → string | null
//
// Returns the canonical invocation string for a known skill id, or null if
// the id is not in the catalog. Used by the route to validate client-supplied
// ids and reject unknowns before any send() call.
// ---------------------------------------------------------------------------
export async function resolveSkillInvocation(repoRoot, id) {
  if (!id || typeof id !== 'string') return null;
  const skills = await listSkills({ repoRoot });
  const found = skills.find((s) => s.id === id);
  return found ? found.invocation : null;
}
