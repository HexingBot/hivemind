---
name: hivemind
type: other
created_at: 2026-06-15T18:30:00.000Z
schema_version: 1
---

# hivemind

## Description
A multi-agent software-development framework: the main Claude Code thread acts as an Orchestrator that delegates to developer/reviewer/researcher subagents, with a tiered verification policy, portable session state, and a local Jira-shaped task store. Distributed as a self-bootstrapping Claude Code plugin whose marketplace is this repo itself.

## Target users
Solo developers and small teams ("me + a few devs") who drive software work through Claude Code and want predictable, verifiable, resumable multi-agent execution.

## Primary use cases
- automation
- collaboration
- integration

## Success criteria
A developer can install the plugin, run discovery-first init on a fresh project, and drive a ticket end-to-end through the orchestrator loop, with an independent review gate and resumable session state, without hand-holding.

## Problem
Solo developers and small teams using LLM coding agents get inconsistent, unverifiable results: no role separation, no independent review gate, tests that grow unboundedly, and lost context between sessions. There is no opinionated harness that turns a single chat agent into a disciplined, resumable, multi-agent dev loop.

## Goals
- Orchestrate every unit of work through a fixed loop: read ticket, plan, verify-per-tier, implement, fresh-context review, close
- Make verification cost scale with risk, not project age (tdd / tests-after / uat-only tiers plus a scaled gate)
- Preserve context across sessions and machines via a portable pointer+bundle session state
- Ship as a one-command, installable, versioned Claude Code plugin that bootstraps an arbitrary project
- Define a project well up front: discovery-first init captures problem, goals, and scope before any code is written

## Scope (in)
- Orchestrator routing plus developer/reviewer/researcher subagents
- Discovery-first project intake (CLI wizard + conversational /init-project) with a confirmation gate and a required problem statement
- Local Jira-shaped task store with a kanban board and an MCP server seam
- Tiered verification policy, use-case regression suite, and conversational UAT
- Portable session bundles, a typed knowledge graph, and deep-review / deep-research workflows

## Scope (out)
- Being a one-shot autonomous product generator (the human stays in the loop on destructive actions)
- Permanently replacing Jira (the local store is an interim, loss-free stand-in until the Atlassian MCP server is wired up)
- Carrying the full orchestration loop to non-Claude-Code clients (subagents are Claude Code-exclusive; the MCP server only broadens ticket CRUD)
- Auto-pushing or closing tickets without explicit human approval

## Stack
- architecture_description: Main Claude Code thread = Orchestrator (orchestrator-routing skill); delegates to file-based developer/reviewer/researcher subagents under .claude/agents/. State is files: a state/session.json pointer + self-contained state/sessions/<id>/ bundles; tickets are per-task JSON under tasks/ with a regenerable index. Node CLIs (bin/init.js, bin/new-task.js) + an MCP task-store server are bundled via esbuild into committed dist/*.cjs and shipped as a Claude Code plugin.

## Preview

<!-- Preview panel configuration for /hivemind:preview.
     This repo is a framework (type: other) with no long-running dev server, so
     no real preview_command is configured here.  When working on a project that
     HAS a dev server, add the relevant fields to your own PROJECT.md frontmatter
     and /preview will work out of the box.  Example for a typical web app:

     preview_command: npm run dev
     preview_port: 3000

     For a fixture-based smoke test you can point at the bundled fixture server:
     preview_command: node tests/fixtures/preview-web/server.js
     preview_port: 4520

     Full field reference (all optional):
       preview_command  — command to spawn (inferred from package.json dev/start/serve if omitted)
       preview_url      — explicit iframe URL (takes precedence over preview_port)
       preview_port     — port number; derives iframe URL http://localhost:<port>
       preview_mode     — 'web' (iframe) | 'process' (log stream); auto-detected if omitted

     See the orchestrator-routing skill for the full precedence and lifecycle docs.
-->
