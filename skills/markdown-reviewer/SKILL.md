---
name: markdown-reviewer
description: Review markdown files for formatting issues. Use after editing .md files, before commits, or when user asks to check markdown.
allowed-tools: Read, Glob
---

# Markdown Reviewer Skill

## Purpose

Review markdown files for common formatting issues that cause rendering problems or inconsistencies.

## When to Use

- After editing `.md` files in `.claude/` or docs/
- Before committing markdown changes
- When user asks to "check markdown" or "review docs"

## Instructions

Review the specified file(s) for these issues:

### 1. Fenced Code Blocks

Every code block MUST have a language identifier.

**Bad:**

````text
```
some code
```
````

**Good:**

````text
```typescript
some code
```
````

Common language tags:

- `text` - pseudo-code, ASCII diagrams, workflow examples
- `typescript`, `bash`, `json`, `yaml` - actual code
- `markdown` - markdown examples

### 2. Table Formatting

- Tables must have header separator row (`|---|---|`)
- Column counts must match across all rows
- Check alignment characters: `:---` (left), `:---:` (center), `---:` (right)

### 3. Consistent Numbering

- If document says "4 gates", verify exactly 4 gates are listed
- Numbered lists should be sequential
- Cross-references must match

### 4. Type Examples

- TypeScript type examples must use valid values for the type
- Don't use example values that aren't in the type definition

### 5. Progress Trees

- Use `├─` for non-last items
- Use `└─` for last item only

## Output Format

```text
## Markdown Review: <filename>

### Issues Found

1. **Line X**: Missing language identifier on code block
2. **Line Y**: Table column count mismatch

### Summary
- X issues found
- Severity: low/medium/high
```

If no issues found: "No markdown issues found in <filename>"
