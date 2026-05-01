# Fallow vs `@graph-flow/graph` — Gap Analysis

**Status:** research / non-binding
**Date:** 2026-05-01
**Branch:** `fallow-codebase-intelligence-review-for-monorepo`
**Sources:**
- [fallow-rs/fallow](https://github.com/fallow-rs/fallow)
- [Fallow README](https://github.com/fallow-rs/fallow/blob/main/README.md)
- [docs.fallow.tools](https://docs.fallow.tools)
- [fallow-rs/fallow-skills](https://github.com/fallow-rs/fallow-skills)
- [GitHub Marketplace listing](https://github.com/marketplace/actions/fallow-codebase-intelligence)

---

## TL;DR

`@graph-flow/graph` and Fallow occupy **different categories**, not different points on the same axis:

- **graph-flow** = symbol-level *exploration* tool for agent workflows. Best at "given this symbol, what touches it?"
- **Fallow** = module-level *audit* tool for CI / IDE. Best at "what in this codebase is unused, cyclic, duplicated, or complex?"

The overlap is only the parser substrate (both walk TS/Vue ASTs). Closing the gap to feature-parity would require an architectural change in graph-flow's relationship model — not just additive analyses.

---

## What `@graph-flow/graph` does today

Verified by reading `packages/graph/src/{parser,indexer,query,cache,vue,mcp-tools}.ts`.

| Capability | Implementation |
|---|---|
| **Parsing** | `ts-morph` for `.ts/.tsx/.jsx`; `@vue/compiler-sfc` for `.vue` |
| **Entity types** | `function`, `class`, `interface`, `type`, `variable`, `component` (PascalCase), `hook` (`useX`) |
| **Relationship types** | `calls`, `imports` (per-named-import), `extends`, `implements`, `uses` (Vue template refs) |
| **Framework heuristics** | JSX element usage as `calls`; `memo` / `forwardRef` wrapper unwrap; Vue `<script setup>` synthesizes a component entity from filename; Vue template `<MyComp />` → `uses` edges |
| **Cache** | sha256 content-hash JSON cache per file (`packages/graph/src/cache.ts`) |
| **Indexer** | Batch with progress, skips cached files |
| **Queries** | `whatCalls(name)`, `blastRadius(name, maxDepth)`, `getDefinitions(file)` |
| **Surface** | MCP tools `g-calls`, `g-blast`, `g-defs`. No CLI for analyses. |

---

## What Fallow does today

Verified from the README and docs (not marketing copy).

### Free, MIT-licensed
- Dead code: unused **files / exports / types / enum members / class members**
- Unused **dependencies**, unlisted dependencies, duplicate exports
- **Unresolved imports**, type-only dependency tracking
- **Circular dependencies** (cross-package)
- **Boundary violations** with 4 presets: `bulletproof`, `layered`, `hexagonal`, `feature-sliced`
- **Stale suppression comments** (`eslint-disable`, `@ts-expect-error`)
- **Private type leaks** (opt-in)
- **Test-only deps** in production code
- **Duplication detection** in 4 modes: `strict`, `mild` (default), `weak`, `semantic`
- **Cyclomatic + cognitive complexity** scoring
- **Maintainability score** (0–100) and **CRAP** (with optional Istanbul coverage)
- **Hotspots** (git-churn × complexity)
- **Static coverage gaps** (`--coverage-gaps`)
- 91 framework plugins (false-positive suppressors)
- Outputs: `human`, `json`, `sarif`, `codeclimate`, `gitlab-codequality`, `annotations`, `markdown`, `badge`, `compact`
- LSP, VS Code extension, **MCP server**, GitHub Action, GitLab CI template
- `fallow audit` with **baselines** + `--fail-on-regression --tolerance` (the canonical adoption pattern)
- `--changed-since <ref>` for PR-scoped analysis
- `fallow fix [--dry-run]` for autofix
- `.fallowrc.json` (or TOML) with per-rule severity (`error` / `warn` / `off`)

### Paid (Fallow Runtime)
- Runtime coverage analysis (V8 / Istanbul JSON)
- Hot-path / cold-path identification
- Cloud coverage analysis
- Ownership-aware hotspots (`--ownership` with bus-factor signals)
- Stale feature-flag branch detection

### Framework plugins relevant to `rollercoaster.dev/monorepo`
- **Listed:** Next.js, Nuxt, Remix, Qwik, SvelteKit, Gatsby, Astro, Angular, NestJS, Expo, Expo Router, Electron; Vite, Webpack, Rspack, Rollup, Tsup, Parcel; Vitest, Jest, Playwright, Cypress, Storybook, Mocha, Ava; Tailwind, PostCSS, UnoCSS, PandaCSS; Prisma, Drizzle, Knex, TypeORM, Kysely, Convex; Hardhat; Turborepo, Nx, Changesets, Syncpack, pnpm.
- **Not listed:** **Hono** (the monorepo's HTTP framework — `openbadges-modular-server`, `openbadges-system`, `rd-logger`)
- **Not separately listed:** standalone **Vue 3 + Vite** (Nuxt is listed; whether plain Vue 3 SFC macro awareness comes from the Nuxt plugin or from a separate Vue plugin is not documented in the README — needs empirical verification)

---

## The gap, by category

### 1. Architectural — the load-bearing one

`@graph-flow/graph`'s relationships use **plain string names** for `from` / `to` (see `cache.ts:31` and the filter at `query.ts:107`: `r.to === entityName`). Two functions called `handleRequest` in different files collide. There's no per-import resolution to a specific exported symbol.

Fallow builds a **resolved module graph**: every `import { x } from "./y"` is resolved to the specific `x` exported by `./y`. This is what enables:
- "Is this specific export reachable from any entry point?" → unused exports
- "Is this file reachable?" → unused files
- "Are there cycles in module dependencies?" → not collapsed by name collisions
- "Does this file import across a forbidden boundary?" → boundary violations

> **Implication:** none of Fallow's flagship analyses — unused files/exports, module-level cycles, boundary violations, unresolved imports — can be implemented on the current graph-flow data model without symbol resolution.
>
> ts-morph supports it (type checker, `findReferences()`), but it's substantially heavier than current name-string matching, both in code and in performance characteristics.

### 2. Missing analyses

| Fallow analysis | graph-flow status |
|---|---|
| Unused files | ✗ |
| Unused exports | ✗ |
| Unused types / enum members / class members | ✗ |
| Unused dependencies vs `package.json` | ✗ — no package.json reader |
| Unlisted dependencies | ✗ |
| Duplicate exports | ✗ |
| Unresolved imports | ✗ |
| Module-level circular dependencies | ✗ — no SCC, graph isn't module-keyed |
| Boundary / architecture violations | ✗ — no config concept |
| Stale `eslint-disable` / `@ts-expect-error` | ✗ |
| Private type leaks | ✗ |
| Test-only deps in production | ✗ |
| Code duplication (any mode) | ✗ — no token/AST-shape index |
| Cyclomatic complexity | ✗ |
| Cognitive complexity | ✗ |
| Maintainability / CRAP | ✗ |
| Hotspots (churn × complexity) | ✗ — no git integration |
| Coverage gaps (static or runtime) | ✗ |

### 3. Adoption-pattern gap

| Fallow | graph-flow |
|---|---|
| Baselines + `--fail-on-regression --tolerance` | ✗ |
| `--changed-since <ref>` | ✗ |
| Per-rule severity in config | ✗ — no config file |
| 4 boundary presets | ✗ |
| 91 framework plugins (FP suppressors) | partial — Vue SFC parsing + React conventions are baked in, but it's not a plugin *system* |
| Auto-fix (`fallow fix`) | ✗ |
| Watch mode | ✗ |
| Migration from knip/jscpd | n/a |

### 4. Output-format gap

graph-flow emits **MCP text only**. Concretely missing surface area:
- **SARIF** → no GitHub Code Scanning integration
- **CodeClimate** / **gitlab-codequality** → no GitLab MR quality gate
- **annotations** → no inline GitHub Action PR comments
- **badge** → no shields.io status
- **markdown** / **json** / **compact** → no machine-actionable or human-friendly reports

### 5. Where graph-flow has something Fallow doesn't

Worth naming — the gap goes both ways:

- **`blastRadius` BFS** — Fallow has no impact-radius query.
- **`whatCalls` reverse-lookup via MCP** — Fallow's MCP server is structured around its own analyses, not free-form symbol queries.
- **Agent-loop integration** — graph-flow is co-designed with planning / checkpoints / knowledge skills. Fallow is CI/IDE-first.

---

## Strategic options

### Option A — Don't compete. Use Fallow alongside graph-flow.

Graph-flow keeps its identity as the **agent-facing exploration substrate**. Fallow handles the audit layer in CI / IDE.

- **Pros:** zero engineering. Fallow is MIT and free for everything graph-flow currently lacks. The two tools serve different surfaces (live agent reasoning vs. CI gate / static report).
- **Cons:** none, except for the Hono/Vue framework-plugin blind spots in Fallow itself. Those would need either custom `entry` config or upstream contributions to `fallow-rs/fallow`.

### Option B — Close the highest-leverage gaps inside `@graph-flow/graph`.

Only worth doing for analyses where having them *inside the agent loop* matters (e.g., during refactor planning).

Cheapest set, in order of marginal cost:
1. **Upgrade relationship model** from name-strings to resolved symbols (`{ moduleSpecifier, exportName }`). Probably 200–400 LOC. Unlocks (2)–(4) at trivial cost each.
2. **Module-level cycle detection** (Tarjan SCC over import edges). ~40 LOC.
3. **Unused exports** (resolved symbols with zero inbound `imports` edges, minus an entry allowlist). ~80 LOC + config.
4. **Boundary checks** (config-driven edge-direction validator). ~60 LOC + config schema.
5. **Cyclomatic complexity** per function (decision-point counter on existing AST walk). ~80 LOC.

Skip until proven needed: duplication (suffix-array work), cognitive complexity (subjective rules), hotspots (needs git integration), coverage (needs Istanbul/V8 ingestion).

### Option C — Reposition graph-flow as a Fallow-MCP consumer.

Wrap Fallow's MCP server with graph-flow's agent skills. Fallow does the audit; graph-flow does the orchestration ("before refactor X, run Fallow, summarize unused-export deltas, decide cleanup PR boundary"). Lowest engineering, highest leverage if the goal is agent workflow quality, not tool independence.

---

## Recommendation

For the **`rollercoaster.dev/monorepo`** specifically — which is the actual target — Option **A or C**. Fallow is free, mature, and covers exactly the analyses that monorepo needs (unused exports across 11 workspaces, cross-package cycles, layered boundaries between `packages/*` and `apps/*`).

For **`graph-flow` as a product**, the gap is too wide to close with quick wins — the symbol-resolution rewrite is a real project, and the analyses on top of it are individually small but collectively a different product. The honest framing is that graph-flow's value is the **agent-facing primitives** (`whatCalls`, `blastRadius`, MCP-first surface), not feature parity with audit tools.

The piece worth investing in regardless: **a Hono framework plugin** (for Fallow or graph-flow's Vue-style heuristics). Hono is core to `rollercoaster.dev/monorepo` and absent from Fallow's plugin list, so route handlers will be flagged as unused exports without it. This is the only gap specific to *this* monorepo that no off-the-shelf tool currently fills.

---

## Empirical findings — Fallow run on `rollercoaster.dev/monorepo`

Joe ran Fallow v2.58.0 against the monorepo on 2026-05-01. Results captured in [issue #961](https://github.com/rollercoaster-dev/monorepo/issues/961) (meta), [#962](https://github.com/rollercoaster-dev/monorepo/issues/962), [#963](https://github.com/rollercoaster-dev/monorepo/issues/963), [#964](https://github.com/rollercoaster-dev/monorepo/issues/964). The `fallow-report.md` itself was gitignored and not preserved.

### Run stats
- 1,222 dead-code findings
- 873 clone groups
- 243K LOC scanned

### Confirmed blind spots
The plugin gaps I speculated about turned out to be real:

| Stack in monorepo | Fallow plugin | Result |
|---|---|---|
| **Vue 3 + Vite** (`openbadges-ui`, `openbadges-system` client) | absent | "Vue components Fallow can't parse" — a major contributor to the 348 unused-files false positives |
| **Hono** (`openbadges-modular-server`, `openbadges-system` server, `rd-logger`) | absent | low signal-to-noise on server-side findings |
| **Bun test** | absent | low signal-to-noise on test files |
| **Histoire** | absent | low signal-to-noise on stories |
| Expo / Vite / Jest / Tailwind | present | usable signal |

### Workspace-export false positive
Fallow flagged `@rollercoaster-dev/design-tokens` and `@rollercoaster-dev/openbadges-core` as unused, but they were actually imported. **Cause:** Fallow couldn't resolve workspace `exports` because `dist/` artifacts weren't built before scanning. A pre-audit `bun run build` mitigates this.

### Real wins despite the noise
Even with plugins missing, the audit produced four actionable issues:
- **#961** — ~6 verified dead Babel/Jest devDeps in `native-rd` (Jest→Bun migration leftovers)
- **#962** — real circular dep in `openbadges-types` (`badge-normalizer.ts ↔ index.ts`), with concrete fix
- **#963** — `design-tokens/./unistyles` ships raw TS (publishing bug)
- **#964** — `setupTestApp` at cyclomatic **142** / cognitive **374** / CRAP **20,306** — worst hotspot in the codebase

### Decision recorded in #961
> *"Adopting Fallow into CI — Vue/Bun/Hono plugins missing, configuration cost too high for current value."*

So Option A (adopt Fallow as-is) is **rejected** based on this evidence. Fallow remains useful as a **periodic manual audit** (regenerate report, file selective issues), not as a CI gate.

## Remaining open questions

1. ~~Vue plugin coverage~~ → **answered:** standalone Vue 3 + Vite is uncovered. Custom plugin or upstream contribution required.
2. ~~Hono FP rate~~ → **answered:** uncovered. Same options.
3. **Symbol-resolution parse cost** in graph-flow at ~500-file scale — still open. Would need a spike branch to benchmark ts-morph type-checker resolution against the current name-string approach.
4. **Integration shape for Option C** — wrap Fallow's MCP, or thin CLI-shelling skill? Still open. Depends on whether graph-flow wants to bet on Fallow's MCP surface staying stable.

## Implications for `@graph-flow/graph` strategy

The empirical run sharpens the picture:

- **Vue/Hono coverage is a real product gap, not just for Fallow.** Whoever fills it — Fallow plugin, graph-flow extension, or a custom tool — captures the analysis surface for this monorepo. Graph-flow already parses Vue SFCs (`packages/graph/src/vue.ts`); it's closer to having Vue awareness than Fallow is.
- **Workspace `exports` resolution must be modeled correctly** in any unused-export analyzer that targets monorepos. This is a concrete requirement Fallow gets wrong without a build step.
- **The audit value is real but bounded.** 4 high-quality issues from 1,222 findings = ~0.3% signal density. An agent-loop-integrated analyzer could plausibly do better by being interactive (ask, refine, re-scope) rather than dumping all findings at once. That's a graph-flow-shaped opportunity, not a Fallow-shaped one.
