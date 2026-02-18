# graph-flow Plugin & MCP Review

> **Note:** This review was written against v2.1.0 and is superseded by v3.0.0. Kept for historical reference.

> Review conducted 2026-02-17 by Claude (Opus 4.6) against graph-flow v2.1.0.
> Tested from within the graph-flow repo itself.

## Status: Nothing Loads

The plugin is installed (`graph-flow@local`) and enabled in `~/.claude/settings.json`, but **zero graph-flow functionality is available in session**:

| Component       | Expected                     | Actual           |
| --------------- | ---------------------------- | ---------------- |
| MCP tools       | 26 tools (c-, k-, g-, p-, a-) | 0 — no `.mcp.json` in project root |
| Plugin skills   | 13 skills                    | 0 — none appear in available skills list |
| Plugin commands | 8 commands                   | 0 — none appear in available commands list |

**Root cause:** The plugin and MCP server are separate things requiring separate setup. The plugin installs skills/commands that reference MCP tools, but without a `.mcp.json` the MCP server never starts. The skills are unusable without the tools they call.

---

## What's Worth Keeping

### Knowledge Tools (`k-store`, `k-query`, `k-related`)

Genuinely useful. MEMORY.md is flat text — a searchable, typed knowledge store with semantic similarity is a real upgrade. `k-related` (find conceptually similar learnings) is something grep can't replicate.

### Planning Stack (`p-goal`, `p-done`, `p-stack`)

The interrupt/resume stack concept is novel. Claude Code's native Task system is flat — no nesting, no "pause this goal to handle an interrupt." A proper stack for tracking context switches fills a real gap.

### Blast Radius (`g-blast`)

The one graph tool that can't be replicated with existing tools. LSP gives direct references, but transitive impact analysis ("what's affected 3 levels deep") requires manually chaining find-references calls today.

### Issue Import (`a-import` + `p-goal` + `c-update`)

Importing a milestone or epic with `a-import` and setting up a goal with `p-goal` + `c-update` replaces 4-5 manual steps. Genuine workflow acceleration. (Note: `a-start-issue` was removed in v3.0.0; the setup skill handles this directly.)

---

## What's Not Worth Keeping

### `g-calls` / `g-defs` (Graph — Calls & Definitions)

LSP already provides `findReferences`, `goToDefinition`, and `documentSymbol`. These are more accurate (using the actual TypeScript compiler) and already work. ts-morph is a slower, less accurate duplicate.

### `c-update` / `c-find` / `c-recover` (Checkpoints)

Conceptually sound, but in practice the checkpoint tools add friction without reward. The value only appears on resume, but by then Claude Code's built-in context management (session memory, context compression) has already handled continuity. Manual `c-update` calls at every step will never happen consistently.

### `k-index` (Batch Index Docs)

Speculative value. If I'm reading docs, I'm reading them for the current task. Batch-indexing markdown into JSONL for hypothetical future search is overhead with no clear payoff — grepping the docs directly is usually sufficient.

### `p-plan` / `p-steps` / `p-progress` / `p-sync` / `p-step-update` (Planning Detail)

Six tools for planning detail that GitHub Issues + Projects already tracks. The `p-sync` tool is particularly telling — it exists because a local mirror of GitHub state needs to be kept in sync. That's a maintenance burden, not a feature.

---

## Recommended Changes

### 1. Eliminate the Plugin/MCP Split

The #1 problem. Either:
- Embed the MCP server config in the plugin manifest so it auto-starts
- Or make skills self-contained (use `gh` CLI + file operations directly instead of routing through MCP tools)

### 2. Reduce from 26 Tools to ~8

**Current:** 4 checkpoint + 4 knowledge + 4 graph + 10 planning + 4 automation = 26 tools

**Proposed:**

| Tool       | Purpose                                     |
| ---------- | ------------------------------------------- |
| `k-store`  | Store a learning                            |
| `k-query`  | Search learnings (TF-IDF + semantic)        |
| `k-related`| Find related learnings by similarity        |
| `p-push`   | Push goal or interrupt onto stack           |
| `p-pop`    | Pop top item, resume previous               |
| `p-stack`  | View current stack state                    |
| `g-blast`  | Transitive blast radius analysis            |
| `a-start`  | Create branch + goal + checkpoint for issue |

Everything else either duplicates built-in capabilities (LSP, Task system, session memory) or mirrors GitHub state that should be queried directly.

### 3. Consolidate Skills from 13 to 3-4

`setup`, `implement`, `review`, `finalize` should be internal phases of `/auto-issue`, not separate skills. Nobody invokes "the review skill" independently.

**Keep:**
- `/auto-issue` — Full autonomous workflow
- `/work-on-issue` — Gated version with human approval
- `/auto-milestone` — Milestone orchestration (if needed)

### 4. Stop Mirroring GitHub State Locally

`p-plan`, `p-steps`, `p-progress`, `p-sync` build a local copy of what GitHub Issues + Projects already tracks. Every sync is a consistency risk. Query GitHub directly via `gh` CLI when you need status.

### 5. Use Markdown Instead of JSONL for Knowledge

JSONL is opaque — can't scan a `.jsonl` file to review learnings. If learnings were stored as markdown files (one per area, with frontmatter), they'd be:
- Human-readable and editable
- Greppable without special tools
- Compatible with MEMORY.md patterns already in use

### 6. Remove Hardcoded Org/Project IDs

`setup/SKILL.md` has hardcoded GraphQL IDs:
- `PVT_kwDOB1lz3c4BI2yZ` (project ID)
- `PVTSSF_lADOB1lz3c4BI2yZzg5MUx4` (field ID)
- `3e320f16` (option ID)

This makes the skill unusable for any project outside `rollercoaster-dev` org, project #11. These should be resolved dynamically or configurable.

---

## What's Missing

### Auto-Checkpointing

The biggest value of checkpoints (resume after interruption) requires manually calling `c-update` at every step. This will never happen consistently. If checkpoints were triggered automatically — via hooks on tool calls, commits, or phase transitions — they'd actually have data when needed for resume.

### A Feedback Loop (Push, Not Pull)

Nothing tells the agent "you have stale context" or "there are learnings from a past session relevant to this file." The system is entirely pull-based — the agent has to know to ask. A push mechanism (a hook that injects relevant context at session start, or on file read) would make adoption automatic.

### Integration with Claude Code's Native Task System

The `/auto-issue` command builds its own task tracking in the skill markdown, but the MCP server and the Task system don't talk to each other. If `p-goal` automatically created a Task, and `p-done` automatically completed it, progress visualization would come for free.

---

## Summary

| Dimension         | Current State                              | Recommendation                     |
| ----------------- | ------------------------------------------ | ---------------------------------- |
| Availability      | Nothing loads — plugin + MCP disconnected  | Auto-start MCP from plugin         |
| Tool count        | 26 MCP tools                               | ~8 tools                           |
| Skill count       | 13 skills                                  | 3-4 skills                         |
| State management  | Local JSONL mirror of GitHub               | Query GitHub directly              |
| Checkpoint usage  | Manual — never gets called                 | Automatic via hooks                |
| Knowledge format  | Opaque JSONL                               | Human-readable markdown            |
| Portability       | Hardcoded org/project IDs                  | Dynamic resolution or config       |

**Core ideas are solid** — especially the planning stack and knowledge persistence. The implementation needs to shed complexity, auto-start reliably, and stop duplicating things that already work (LSP, GitHub, session memory, Task system).
