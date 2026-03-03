# /visual-test \<mode> \<issue-number>

Capture visual evidence for frontend work: Figma designs, before/after app screenshots, and design comparison.

**Mode:** Standalone or composed into `/auto-issue --visual`.

---

## Quick Reference

```bash
/visual-test design 123                          # Capture Figma design for issue #123
/visual-test before 123                          # Capture current app state
/visual-test after 123                           # Capture end state + compare with design
/visual-test before 123 --url http://localhost:3000/page
/visual-test after 123 --viewports 1280,768,375
/visual-test design 123 --figma-url https://figma.com/...
/visual-test before 123 --dev-cmd "bun run dev"
```

## Arguments

| Argument | Position | Required | Description                                      |
| -------- | -------- | -------- | ------------------------------------------------ |
| `mode`   | 1st      | Yes      | `design`, `before`, or `after`                   |
| `number` | 2nd      | Yes      | GitHub issue number                              |

## Flags

| Flag                    | Description                                       |
| ----------------------- | ------------------------------------------------- |
| `--url <url>`           | Explicit app URL (skips dev server detection)      |
| `--figma-url <url>`     | Explicit Figma URL (skips issue body scan)         |
| `--viewports <widths>`  | Comma-separated viewport widths (default: `1280`)  |
| `--dev-cmd <cmd>`       | Explicit dev server command                        |

## Modes

### `design` - Capture Figma Reference

Captures the Figma design linked in the issue body (or provided via `--figma-url`). Saves to `.claude/screenshots/issue-<N>/design-overview.png`.

Use this **before** starting implementation to establish the design target.

### `before` - Capture Current State + Inventory Components

Captures the app's current state at the relevant page. Finds or starts a dev server, navigates to the test URL, and takes screenshots at each viewport width. Also scans the project for existing UI components and libraries, saving an inventory to `.claude/screenshots/issue-<N>/components.md` so the implementation phase reuses what exists.

Use this **before** making changes to establish the baseline.

### `after` - Capture Final State + Compare

Captures the app's state after implementation, then compares with design screenshots (if they exist). Produces a comparison report at `.claude/screenshots/issue-<N>/comparison.md`.

Use this **after** implementation is complete to document the result.

---

## Screenshot Storage

```text
.claude/screenshots/issue-<N>/
  design-overview.png     # Figma design capture
  before-1280.png         # App state before changes
  after-1280.png          # App state after changes
  after-768.png           # Additional viewport (if requested)
  components.md           # Existing component inventory
  comparison.md           # Design vs implementation notes
  dev-server.json         # Server metadata
```

---

## Workflow

```text
Skill(visual-test):
  Input:  { mode, issue_number, [test_url], [figma_url], [viewports], [dev_server_cmd] }
  Output: { screenshots[], design_url, app_url, browser_tool, skipped, skip_reason }
```

1. Detect available browser tools (Playwright MCP or Claude-in-Chrome)
2. Route by mode:
   - `design` → Capture Figma design
   - `before` → Capture app state, leave dev server running
   - `after` → Capture app state, compare with design, stop dev server if we started it
3. Return screenshot paths and metadata

---

## Error Handling

Visual capture is **best-effort** and never blocks the workflow:

| Condition              | Behavior                            |
| ---------------------- | ----------------------------------- |
| No browser tools       | Skip all, return `skipped=true`     |
| Figma URL not found    | Skip design capture, continue       |
| Figma requires auth    | Skip with warning                   |
| Dev server won't start | Skip app capture, `skipped=true`    |
| Screenshot fails       | Log warning, continue with others   |
