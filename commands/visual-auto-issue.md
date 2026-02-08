# /visual-auto-issue <issue-number> [flags]

Wraps `/auto-issue` with before/after browser screenshots. The inner workflow is unchanged — this command bookends it with visual verification.

**Flags:** All `/auto-issue` flags pass through (`--dry-run`, `--skip-review`, `--force-pr`).

---

## Phase 0: Visual Setup (BEFORE implementation)

### Step 1: Generate Sitemap

```bash
bun scripts/generate-sitemap.ts
```

Parse the JSON output to get `static` and `dynamic` route lists.

### Step 2: Match Issue to Routes

Fetch issue details:

```bash
gh issue view <N> --json title,body,labels -q '{title: .title, body: .body, labels: [.labels[].name]}'
```

**Match logic:**

1. Extract keywords from issue title + body (component names, page names, feature areas)
2. Fuzzy-match keywords against the sitemap routes. Examples of common matches (not exhaustive — always match dynamically against the sitemap output):
   - "badge" → `/badges`, `/badges/create`, `/badges/issued`
   - "backpack" → `/backpack`
   - "issuer" → `/issuers`, `/issuers/create`, `/issuers/manage`
   - "admin" → `/admin`, `/admin/badges`, `/admin/system`, `/admin/users`
   - "auth" / "login" / "oauth" → `/auth/login`, `/auth/register`, `/auth/profile`, `/auth/oauth/callback`
   - "verify" → (skip, dynamic only)
   - "home" / "landing" / "dashboard" → `/`
3. Always include `/` as baseline
4. Skip dynamic routes (`:id`) unless issue provides specific test IDs
5. If no keywords match, screenshot all static routes

Store the matched routes as the **focus routes** for this run.

### Step 3: Take BEFORE Screenshots

Start dev server on current branch (main):

```bash
bun --filter openbadges-system dev &
DEV_PID=$!
```

Wait for server ready (poll until responding). The default port is 7777; if `SYSTEM_VITE_PORT` or `VITE_PORT` is set, or if 7777 is occupied (`strictPort: false`), detect the actual port from the server output.

```bash
for i in $(seq 1 30); do curl -s http://localhost:7777 > /dev/null && break; sleep 2; done
```

If all 30 attempts fail, the server did not start — log a warning and skip screenshots per the error handling table.

Create screenshot directory:

```bash
mkdir -p .claude/screenshots/issue-<N>/before
```

For each focus route, use Playwright MCP tools:

1. `browser_navigate` to `http://localhost:7777<route>`
2. `browser_wait_for` — wait for page content to settle (1-2 seconds)
3. `browser_take_screenshot` — save to `.claude/screenshots/issue-<N>/before/<route-slug>.png`

Route slug: replace `/` with `-`, strip leading dash. E.g., `/badges/create` → `badges-create`, `/` → `index`.

Stop dev server:

```bash
kill $DEV_PID 2>/dev/null
```

---

## Phases 1–5: Inner Workflow

Run the inner workflow, passing all arguments through:

```bash
/auto-issue <N> [flags]
```

This executes the full autonomous workflow (setup, research, implement, review, finalize) **completely unchanged**. It produces a PR.

**Capture the PR number and branch name from the workflow output.**

If `--dry-run` was passed, the inner workflow stops after research. Skip Phase 6 — no after screenshots needed. Before screenshots are still captured during `--dry-run` to document the current visual state alongside the research plan.

---

## Phase 6: Visual After (AFTER implementation)

### Step 1: Take AFTER Screenshots

We are now on the feature branch with all changes committed. The PR already exists.

Start dev server on the feature branch:

```bash
bun --filter openbadges-system dev &
DEV_PID=$!
```

Wait for server ready (same port detection as Phase 0):

```bash
for i in $(seq 1 30); do curl -s http://localhost:7777 > /dev/null && break; sleep 2; done
```

Create screenshot directory:

```bash
mkdir -p .claude/screenshots/issue-<N>/after
```

Screenshot the **same focus routes** as Phase 0, saving to `.claude/screenshots/issue-<N>/after/<route-slug>.png`.

Stop dev server:

```bash
kill $DEV_PID 2>/dev/null
```

### Step 2: Commit and Push Screenshots

```bash
git add .claude/screenshots/issue-<N>/
git commit -m "chore: add visual verification screenshots for #<N>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
git push
```

### Step 3: Add PR Comment with Before/After Images

Get the branch name:

```bash
BRANCH=$(git branch --show-current)
```

Build a PR comment with before/after comparison tables. For each focus route, construct image URLs:

```text
https://raw.githubusercontent.com/rollercoaster-dev/monorepo/<BRANCH>/.claude/screenshots/issue-<N>/before/<slug>.png
https://raw.githubusercontent.com/rollercoaster-dev/monorepo/<BRANCH>/.claude/screenshots/issue-<N>/after/<slug>.png
```

Post the comment:

```bash
gh pr comment <PR_NUMBER> --body "$(cat <<'EOF'
## Visual Verification

### Before (main)
| Route | Screenshot |
|-------|-----------|
| `<route>` | ![before-<slug>](<before-url>) |
...

### After (implementation)
| Route | Screenshot |
|-------|-----------|
| `<route>` | ![after-<slug>](<after-url>) |
...

---
*Screenshots taken by visual-auto-issue wrapper*
EOF
)"
```

---

## Error Handling

| Error                        | Behavior                                          |
| ---------------------------- | ------------------------------------------------- |
| Dev server won't start       | Warn, skip screenshots, run inner workflow anyway |
| Screenshot fails for a route | Warn, continue with other routes                  |
| Inner workflow fails         | Stop — no after screenshots                       |
| Screenshot commit/push fails | Warn, still post PR comment without images        |
| `--dry-run` flag             | Take before screenshots only, skip after          |

---

## Summary

```text
visual-auto-issue <N>
├─ Phase 0: Generate sitemap → match issue → screenshot BEFORE
├─ Phases 1-5: /auto-issue <N> (unchanged)
└─ Phase 6: Screenshot AFTER → commit → PR comment
```

**Note:** Screenshots are committed to the feature branch only. They are pruned when the branch is deleted after merge.
