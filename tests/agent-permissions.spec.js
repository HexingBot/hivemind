// tests/agent-permissions.spec.js
// TASK-091 — developer Bash allowlist generator: pure mapping logic (no disk
// I/O), so it lives in the fast tier alongside tests/agent-models.spec.js.
// Surgical-patch + CLI-flag + idempotent-reapply specs (real I/O) live in
// tests/e2e/agent-permissions-config.spec.js.
//
// AC map:
//   AC1 (mapping half) — core git/npm/node/npx always included; stack-specific
//     additions added per declared dev_stack token; unknown stack values
//     rejected with a clear, offender-naming error before any write.
//   AC1 (preservation half) — the five non-Bash tools currently on
//     agents/developer.md's frontmatter (Read, Write, Edit, Grep, Glob,
//     mcp__github__*) are carried through unchanged.

import { describe, it, expect } from 'vitest';

import { generateDeveloperToolsLine } from '../src/agent-generator.js';

const CORE_BASH = ['Bash(git:*)', 'Bash(npm:*)', 'Bash(node:*)', 'Bash(npx:*)'];
const NON_BASH_TOOLS = ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'mcp__github__*'];

describe('AC1 — generateDeveloperToolsLine: core Bash prefixes always present', () => {
  it('empty_dev_stack_yields_only_core_bash_patterns', () => {
    const line = generateDeveloperToolsLine({ devStack: [] });
    for (const pattern of CORE_BASH) {
      expect(line.includes(pattern), `expected ${pattern} in "${line}"`).toBe(true);
    }
  });

  it('absent_dev_stack_yields_only_core_bash_patterns', () => {
    const line = generateDeveloperToolsLine({});
    for (const pattern of CORE_BASH) {
      expect(line.includes(pattern), `expected ${pattern} in "${line}"`).toBe(true);
    }
  });

  it('core_bash_patterns_present_regardless_of_declared_stack', () => {
    const line = generateDeveloperToolsLine({ devStack: ['python'] });
    for (const pattern of CORE_BASH) {
      expect(line.includes(pattern), `expected ${pattern} in "${line}"`).toBe(true);
    }
  });
});

describe('AC1 — generateDeveloperToolsLine: existing non-Bash tools preserved exactly', () => {
  it('all_five_non_bash_tools_present', () => {
    const line = generateDeveloperToolsLine({ devStack: [] });
    for (const tool of NON_BASH_TOOLS) {
      expect(line.includes(tool), `expected "${tool}" in "${line}"`).toBe(true);
    }
  });

  it('bare_bash_tool_is_not_present_bare_only_scoped_patterns', () => {
    // The bare, unrestricted `Bash` token must never appear — only
    // parenthesized Bash(...) patterns.
    const line = generateDeveloperToolsLine({ devStack: [] });
    const tokens = line.split(',').map((s) => s.trim());
    expect(tokens.includes('Bash'), `bare "Bash" must not appear in "${line}"`).toBe(false);
  });
});

describe('AC1 — generateDeveloperToolsLine: stack-specific additions', () => {
  it('python_stack_adds_python_pip_pytest', () => {
    const line = generateDeveloperToolsLine({ devStack: ['python'] });
    expect(line.includes('Bash(python:*)')).toBe(true);
    expect(line.includes('Bash(pip:*)')).toBe(true);
    expect(line.includes('Bash(pytest:*)')).toBe(true);
  });

  it('vue_and_react_both_add_vitest_without_duplicating', () => {
    const line = generateDeveloperToolsLine({ devStack: ['vue', 'react'] });
    const occurrences = line.split('Bash(vitest:*)').length - 1;
    expect(occurrences, `expected exactly one Bash(vitest:*) in "${line}"`).toBe(1);
  });

  it('go_stack_adds_go', () => {
    const line = generateDeveloperToolsLine({ devStack: ['go'] });
    expect(line.includes('Bash(go:*)')).toBe(true);
  });

  it('rust_stack_adds_cargo', () => {
    const line = generateDeveloperToolsLine({ devStack: ['rust'] });
    expect(line.includes('Bash(cargo:*)')).toBe(true);
  });

  it('ruby_stack_adds_ruby_bundle_rspec', () => {
    const line = generateDeveloperToolsLine({ devStack: ['ruby'] });
    expect(line.includes('Bash(ruby:*)')).toBe(true);
    expect(line.includes('Bash(bundle:*)')).toBe(true);
    expect(line.includes('Bash(rspec:*)')).toBe(true);
  });

  it('java_stack_adds_mvn_gradle', () => {
    const line = generateDeveloperToolsLine({ devStack: ['java'] });
    expect(line.includes('Bash(mvn:*)')).toBe(true);
    expect(line.includes('Bash(gradle:*)')).toBe(true);
  });

  it('comma_separated_string_form_is_accepted_like_an_array', () => {
    const fromArray = generateDeveloperToolsLine({ devStack: ['python', 'go'] });
    const fromString = generateDeveloperToolsLine({ devStack: 'python, go' });
    expect(fromString).toBe(fromArray);
  });
});

describe('AC1 — generateDeveloperToolsLine: unknown stack value rejected before any write', () => {
  it('unknown_token_throws_naming_the_offending_value', () => {
    expect(() => generateDeveloperToolsLine({ devStack: ['cobol'] })).toThrow(/cobol/);
  });

  it('unknown_token_throws_even_when_mixed_with_valid_tokens', () => {
    expect(() => generateDeveloperToolsLine({ devStack: ['python', 'cobol'] })).toThrow(/cobol/);
  });
});
