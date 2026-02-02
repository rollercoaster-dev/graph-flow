# Missing Features from v1.x

## Graph/Parser Features

### ✅ Already in v1.x (Need to add to v2.0)

| Feature | v1.x | v2.0 | Priority |
|---------|------|------|----------|
| **Vue SFC parsing** | ✅ Full support (@vue/compiler-sfc) | ❌ Missing | 🔴 HIGH |
| **Tree-sitter parsing** | ✅ Multi-language (tree-sitter-wasms) | ❌ Missing (only ts-morph) | 🔴 HIGH |
| **Component extraction** | ✅ From Vue templates | ❌ Missing | 🔴 HIGH |
| **Python parsing** | ✅ (via tree-sitter) | ❌ Missing | 🟡 MEDIUM |
| **Go parsing** | ✅ (via tree-sitter) | ❌ Missing | 🟡 MEDIUM |
| **Rust parsing** | ✅ (via tree-sitter) | ❌ Missing | 🟡 MEDIUM |
| **JSX/TSX parsing** | ✅ (ts-morph) | ✅ Should work | ✅ OK |

## Formatter Features

### Context Formatting
| Feature | v1.x | v2.0 | Priority |
|---------|------|------|----------|
| **Format as bullets** | ✅ | ❌ Missing | 🟡 MEDIUM |
| **Format as XML** | ✅ | ❌ Missing | 🟡 MEDIUM |
| **Group by code area** | ✅ | ❌ Missing | 🟡 MEDIUM |
| **Sort by relevance** | ✅ | ❌ Missing | 🟡 MEDIUM |
| **Token estimation** | ✅ | ❌ Missing | 🟡 MEDIUM |
| **Priority calculation** | ✅ | ❌ Missing | 🟡 MEDIUM |

## Planning System

| Feature | v1.x | v2.0 | Priority |
|---------|------|------|----------|
| **Planning stack** | ✅ | ❌ Missing | 🟢 LOW (might be unused) |
| **Progress tracking** | ✅ | ❌ Missing | 🟢 LOW |
| **Stale detection** | ✅ | ❌ Missing | 🟢 LOW |
| **Plan summarization** | ✅ | ❌ Missing | 🟢 LOW |
| **Completion cache** | ✅ | ❌ Missing | 🟢 LOW |

## Session/Context Features

| Feature | v1.x | v2.0 | Priority |
|---------|------|------|----------|
| **Context builder** | ✅ Auto-injects context | ❌ Changed to pull-based | 🟡 MEDIUM |
| **Session hooks** | ✅ onSessionStart/End | ❌ Missing | 🟡 MEDIUM |
| **Workflow formatting** | ✅ | ❌ Missing | 🟡 MEDIUM |
| **Knowledge formatting** | ✅ | ❌ Missing | 🟡 MEDIUM |

## Dependencies in v1.x

```json
{
  "ts-morph": "27.0.2",                    // ✅ Have in v2.0
  "@vue/compiler-sfc": "3.5.24",           // ❌ MISSING - need for Vue
  "tree-sitter-wasms": "0.1.13",           // ❌ MISSING - need for Python/Go/Rust
  "web-tree-sitter": "0.26.3",             // ❌ MISSING - need for tree-sitter
  "marked": "17.0.1",                      // ❌ MISSING - Markdown parsing
  "@modelcontextprotocol/sdk": "^1.11.0"   // ✅ Have in v2.0
}
```

## Critical Missing Features

### 🔴 HIGH PRIORITY (User needs these NOW)

1. **Vue SFC Parsing**
   - Extract `<script>` and `<script setup>` content
   - Parse template for component usage
   - Handle Composition API and Options API
   - Status: **v1.x has this fully implemented!**

2. **Tree-sitter Multi-language Support**
   - Python parsing
   - Go parsing
   - Rust parsing
   - Any language tree-sitter supports
   - Status: **v1.x has this!**

### 🟡 MEDIUM PRIORITY (Nice to have)

3. **Context Formatters**
   - Format learnings/workflows for context injection
   - Group by code area
   - Sort by relevance
   - Estimate token usage

4. **Session Hooks**
   - Auto-inject relevant context at session start
   - Cleanup on session end
   - Note: v2.0 changed to pull-based (might be better)

### 🟢 LOW PRIORITY (Check if actually used)

5. **Planning System**
   - Might be unused/deprecated
   - Check usage logs first

## Immediate Actions Needed

### Must Add (User confirmed need):
- [ ] Vue SFC parsing
- [ ] Tree-sitter support (Python, Go, Rust, etc.)
- [ ] Component extraction from templates

### Should Add (Quality of life):
- [ ] Context formatters
- [ ] Session hooks (optional - new pattern might be better)

### Maybe Add (Verify usage first):
- [ ] Planning system (check if it's actually used)
- [ ] Markdown parsing (check if needed)

## How to Add Them

### Quick Wins (Copy from v1.x):
1. Copy `extractVueScript()` function → Add to parser.ts
2. Add `@vue/compiler-sfc` dependency
3. Update file finder to include `.vue` files
4. Add tests for Vue parsing

### Bigger Work (Tree-sitter):
1. Add tree-sitter dependencies
2. Port tree-sitter parser wrapper
3. Add language grammars (Python, Go, Rust)
4. Update parser to detect language by extension
5. Add tests for each language

### Medium Work (Formatters):
1. Copy formatter.ts module
2. Add to knowledge package
3. Update MCP tools to support formatting options
4. Add tests

## Bottom Line

**v2.0 is missing significant language support!**
- Only supports TS/JS (via ts-morph)
- v1.x supports: **TS, JS, Vue, Python, Go, Rust** (via tree-sitter)

**User needs:**
- ✅ Vue parsing - CONFIRMED
- ❓ Python/Go/Rust - TBD
- ❓ Formatters - TBD

**Next step:** Add Vue parsing NOW, ask about other languages.
