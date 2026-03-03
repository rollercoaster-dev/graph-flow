---
name: visual-test
description: Captures visual evidence for frontend work - Figma designs, before/after app screenshots, and design comparison. Best-effort, never blocks workflow.
allowed-tools: Bash, Read, Write, Glob, Grep, mcp__playwright__*, mcp__claude-in-chrome__*
---

# Visual Test Skill

Captures screenshots for visual verification of frontend changes.

## Contract

### Input

| Field            | Type     | Required | Description                                         |
| ---------------- | -------- | -------- | --------------------------------------------------- |
| `mode`           | string   | Yes      | `"design"`, `"before"`, or `"after"`                |
| `issue_number`   | number   | Yes      | GitHub issue number                                 |
| `test_url`       | string   | No       | Explicit app URL (skips dev server detection)        |
| `figma_url`      | string   | No       | Explicit Figma URL (skips issue body scan)           |
| `viewports`      | number[] | No       | Viewport widths in px (default: `[1280]`)            |
| `dev_server_cmd` | string   | No       | Explicit dev server command                          |

### Output

| Field          | Type     | Description                                          |
| -------------- | -------- | ---------------------------------------------------- |
| `screenshots`      | array    | `{ path, viewport, mode, source }` for each capture  |
| `design_url`       | string   | Figma URL used (if design mode)                      |
| `app_url`          | string   | App URL captured (if before/after mode)              |
| `browser_tool`     | string   | `"playwright"`, `"chrome"`, or `"none"`              |
| `components_path`  | string   | Path to component inventory (if before mode)          |
| `skipped`          | boolean  | True if all capture was skipped                      |
| `skip_reason`      | string   | Why (if skipped)                                     |

### Side Effects

1. Creates screenshot files in `.claude/screenshots/issue-<N>/`
2. May start a dev server (left running in `before` mode, stopped in `after` mode)
3. Creates `dev-server.json` with server metadata (if server was started)
4. Creates `components.md` with project component inventory (in `before` mode)
5. Creates `comparison.md` with design comparison notes (in `after` mode)

## Prerequisites

Requires at least one browser tool:
- **Playwright MCP** (`mcp__playwright__*`) — preferred, full viewport control
- **Claude-in-Chrome** (`mcp__claude-in-chrome__*`) — fallback, minimum width ~826px

If neither is available, skill returns `skipped=true` immediately.

## Workflow

### Step 1: Detect Browser Tools

Check which browser automation is available:

1. Check for Playwright MCP tools (`mcp__playwright__browser_navigate`, etc.)
2. Check for Claude-in-Chrome tools (`mcp__claude-in-chrome__navigate`, etc.)
3. If neither found → return `{ skipped: true, skip_reason: "No browser tools available" }`

Record which tool is available as `browser_tool`.

**Note:** Playwright supports arbitrary viewport widths. Claude-in-Chrome has a minimum width of ~826px — viewports below this will be skipped with a warning.

### Step 2: Route by Mode

- `design` → Step 3 (Figma capture)
- `before` → Step 4 (app capture), then Step 4.5 (component inventory)
- `after` → Step 4 (app capture), then Step 5 (comparison)

### Step 3: Capture Figma Design (design mode only)

**3a. Find Figma URL:**

If `figma_url` provided, use it. Otherwise:

```bash
gh issue view <issue_number> --json body -q .body
```

Scan the issue body for Figma links matching:
- `figma.com/design/...`
- `figma.com/file/...`
- `figma.com/proto/...`

If the issue body references a "design issue" (e.g., "See #45 for design"), fetch that issue and scan its body too.

If no Figma URL found → return `{ skipped: true, skip_reason: "No Figma URL found in issue body" }`

**3b. Open Figma in browser:**

Navigate to the Figma URL. Wait for the page to load — Figma renders asynchronously, so wait for the canvas element to appear.

If Figma shows a login/auth wall → return `{ skipped: true, skip_reason: "Figma requires authentication — user must be logged in" }`

**3c. Capture design screenshots:**

```text
mkdir -p .claude/screenshots/issue-<N>/
```

Take a screenshot of the design at current zoom. Save to:

```text
.claude/screenshots/issue-<N>/design-overview.png
```

If specific frames or pages are identifiable in the Figma file, capture those as additional screenshots:

```text
.claude/screenshots/issue-<N>/design-<frame-name>.png
```

**3d. Return** screenshot paths and Figma URL.

### Step 4: Capture App State (before/after modes)

**4a. Detect test URL** (if `test_url` not provided):

Scan the issue body for:
- Explicit URLs (`http://localhost:...`)
- Route paths (`/dashboard`, `/settings`)
- Keywords: "test at", "navigate to", "page:", "route:"

If no URL found in issue, analyze changed files to infer routes:
- Page/view components → framework routing conventions
- Fall back to dev server root (`http://localhost:<port>/`)

**4b. Find or start dev server:**

Check if a server is already running:

```bash
lsof -i :3000 -i :3001 -i :4173 -i :5173 -i :5174 -i :8080 -t 2>/dev/null
```

If no server is running:
- If `dev_server_cmd` provided, use it
- Otherwise detect from `package.json` scripts: `dev` > `start:dev` > `serve` > `start`

Start in background, wait up to 30s for the port to accept connections.

Record server metadata:

```text
.claude/screenshots/issue-<N>/dev-server.json
```

```json
{
  "cmd": "<command used>",
  "port": <port>,
  "pid": <pid>,
  "started_by_skill": true
}
```

If dev server won't start after 30s → return `{ skipped: true, skip_reason: "Dev server failed to start" }`

**4c. Capture screenshots:**

```text
mkdir -p .claude/screenshots/issue-<N>/
```

For each viewport width in `viewports` (default `[1280]`):

1. Navigate to the test URL
2. Resize viewport to `<width>` x `900`
3. Wait for page to be idle (no pending network requests)
4. Take screenshot
5. Save to `.claude/screenshots/issue-<N>/<mode>-<width>.png`

If a screenshot fails for one viewport, log warning and continue with remaining viewports.

**4d. Dev server lifecycle:**

- `before` mode: Leave dev server running (implementation happens next)
- `after` mode: Stop the dev server if `started_by_skill` is true in `dev-server.json`

### Step 4.5: Inventory Existing Components (before mode only)

Before implementation begins, scan the project for existing UI components so the implement phase reuses them instead of reaching for raw HTML elements or building duplicates.

**4.5a. Detect component locations:**

Search for common component directory patterns:

```text
Glob: **/components/**/*.{tsx,jsx,vue,svelte}
Glob: **/ui/**/*.{tsx,jsx,vue,svelte}
Glob: **/shared/**/*.{tsx,jsx,vue,svelte}
Glob: **/lib/components/**/*.{tsx,jsx,vue,svelte}
Glob: **/design-system/**/*.{tsx,jsx,vue,svelte}
```

Also check for a UI library dependency in `package.json`:
- `@radix-ui/*`, `@headlessui/*`, `@mui/*`, `@chakra-ui/*`, `@mantine/*`, `shadcn`, `daisyui`, `@ant-design/*`

**4.5b. Build component inventory:**

For each component file found, extract:
- Component name (from filename or default export)
- Category (form, layout, feedback, navigation, data display — inferred from name/directory)
- Props signature (from TypeScript interface/type if available)

For UI library dependencies, note which packages are installed and their common component names (e.g., `@radix-ui/react-dialog` → `Dialog` is available).

**4.5c. Save inventory:**

Write to `.claude/screenshots/issue-<N>/components.md`:

```markdown
# Component Inventory: Issue #<N>

## UI Library
- <library name> (<version>) — provides: Dialog, Button, Select, ...

## Project Components

### Form
| Component | Path | Key Props |
|-----------|------|-----------|
| Button | src/components/ui/Button.tsx | variant, size, disabled |
| Input | src/components/ui/Input.tsx | label, error, placeholder |

### Layout
| Component | Path | Key Props |
|-----------|------|-----------|
| Card | src/components/ui/Card.tsx | title, footer |
| Sidebar | src/components/layout/Sidebar.tsx | collapsed, items |

### Feedback
...

## Usage Guidance
- Use <Button> instead of <button> — supports theme variants
- Use <Input> instead of <input> — includes label, error states, accessibility
- Use <Dialog> from <library> instead of building a modal
```

This file is referenced by the implement skill to avoid building components that already exist.

**4.5d. Return** component inventory path in output.

### Step 5: Compare with Design (after mode only)

After capturing `after` screenshots, compare with design:

**5a. Load screenshots:**

```text
.claude/screenshots/issue-<N>/design-*.png  → design screenshots
.claude/screenshots/issue-<N>/after-*.png   → after screenshots
```

If no design screenshots exist, skip comparison.

**5b. Visual comparison:**

Present both design and after screenshots to Claude's vision. Describe:
- Does the implementation match the design?
- What differences exist? (layout, spacing, colors, missing elements)
- Overall fidelity assessment (high/medium/low match)

**5c. Save comparison report:**

Write findings to `.claude/screenshots/issue-<N>/comparison.md`:

```markdown
# Visual Comparison: Issue #<N>

## Design Reference
![design](design-overview.png)

## Implementation
![after](after-1280.png)

## Assessment

**Fidelity:** <high/medium/low>

### Matches
- <what matches the design>

### Differences
- <what differs from the design>

### Notes
- <any additional observations>
```

This comparison is **informational** — included in the PR body for human review, not used as a pass/fail gate.

## Error Handling

| Condition                     | Behavior                                     |
| ----------------------------- | -------------------------------------------- |
| No browser tools available    | `skipped=true`, return immediately            |
| Figma URL not found           | Skip design capture, continue                 |
| Figma requires authentication | Skip design capture with warning              |
| Dev server won't start        | Skip app capture, `skipped=true`              |
| Screenshot fails (one)        | Log warning, continue with remaining          |
| All screenshots fail          | `skipped=true` with reason                    |
| Issue not found               | Return error                                  |

**Visual capture NEVER blocks the workflow.**

## Example

**Input:**

```json
{
  "mode": "before",
  "issue_number": 123,
  "viewports": [1280, 768]
}
```

**Output:**

```json
{
  "screenshots": [
    { "path": ".claude/screenshots/issue-123/before-1280.png", "viewport": 1280, "mode": "before", "source": "app" },
    { "path": ".claude/screenshots/issue-123/before-768.png", "viewport": 768, "mode": "before", "source": "app" }
  ],
  "app_url": "http://localhost:5173/dashboard",
  "browser_tool": "playwright",
  "skipped": false
}
```

**Input (design mode, no Figma URL):**

```json
{
  "mode": "design",
  "issue_number": 456
}
```

**Output:**

```json
{
  "screenshots": [],
  "browser_tool": "playwright",
  "skipped": true,
  "skip_reason": "No Figma URL found in issue body"
}
```

## Output Format

After completing all steps, report:

```text
VISUAL-TEST COMPLETE

Mode: <mode>
Issue: #<issue_number>
Browser: <browser_tool>

Screenshots:
  - <path> (<viewport>px, <source>)
  - <path> (<viewport>px, <source>)

<if comparison was done>
Design Comparison: <fidelity>
  See .claude/screenshots/issue-<N>/comparison.md

<if skipped>
Skipped: <skip_reason>
```
