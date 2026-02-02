# graph-flow v2.0 Architecture

## Problem Statement

**v1.x Issues:**
- SQLite lock contention caused Claude Code to freeze
- Monolithic 1131-line sqlite.ts was hard to refactor
- Useful tools existed but were blocked by DB issues

**v2.0 Solution:**
- File-based storage → no locks → no freezing
- 3 independent packages → simple, maintainable
- Working tools first → optimize later

## Core Principles

### 1. No Shared Database = No Lock Contention

Instead of a shared SQLite database, each subsystem uses its own file-based storage:

```
Checkpoint → .claude/workflows/*.jsonl    (append-only, in-memory cache)
Knowledge  → .claude/learnings/*.jsonl    (append-only, TF-IDF search)
Graph      → .claude/graphs/*.json        (content-hash cache)
```

This eliminates lock contention entirely:
- Each workflow gets its own file
- Writes are append-only (no read locks needed)
- Caches are in-memory (no disk I/O during reads)

### 2. Ephemeral vs Persistent Storage

Different data has different lifecycles:

**Ephemeral (Workflows):**
- Created at session start
- Updated during session
- Deleted on completion
- Cache: In-memory LRU (100 entries max)
- Storage: JSONL event log

**Persistent (Learnings):**
- Accumulate over time
- Rarely deleted
- Searched frequently
- Cache: TF-IDF index (rebuilt on demand)
- Storage: Area-based JSONL files

**On-Demand (Graphs):**
- Generated when needed
- Invalidated on file change
- Cache: Content-hash based
- Storage: JSON files (1 per source file)

### 3. Simple, Independent Packages

Each package is <500 LOC and does one thing:

```
@graph-flow/checkpoint
├── storage.ts      (JSONL operations)
├── cache.ts        (LRU cache)
├── workflow.ts     (workflow CRUD)
└── mcp-tools.ts    (MCP integration)

@graph-flow/knowledge
├── storage.ts      (area-based JSONL)
├── search.ts       (TF-IDF search)
├── learning.ts     (learning CRUD)
└── mcp-tools.ts    (MCP integration)

@graph-flow/graph
├── cache.ts        (hash-based cache)
├── parser.ts       (ts-morph wrapper)
├── query.ts        (graph queries)
└── mcp-tools.ts    (MCP integration)

@graph-flow/mcp
└── index.ts        (unified MCP server)
```

## Storage Layer

### JSONL Format (Checkpoint & Knowledge)

**Why JSONL?**
- Append-only writes (no locks)
- Human-readable (debugging)
- Git-friendly (line-based diffs)
- Streaming-friendly (large files)

**Event Sourcing (Workflows):**
```jsonl
{"timestamp":"2024-01-01T00:00:00Z","type":"created","data":{...}}
{"timestamp":"2024-01-01T00:01:00Z","type":"phase_change","data":{...}}
{"timestamp":"2024-01-01T00:02:00Z","type":"context_added","data":{...}}
```

State is reconstructed by replaying events. This enables:
- Time-travel debugging
- Audit trails
- Rollback capabilities

**Area-Based Organization (Learnings):**
```
learnings/
├── auth.jsonl       (all auth-related learnings)
├── api.jsonl        (all API-related learnings)
└── database.jsonl   (all DB-related learnings)
```

This enables:
- Efficient area filtering
- Better cache locality
- Easier manual inspection

### JSON Format (Graphs)

**Why JSON for graphs?**
- Complex nested data (entities + relationships)
- Random access needed
- Cache invalidation via hash

**Hash-Based Naming:**
```
graphs/
├── src_auth_login-abc123.json    (hash: abc123)
└── src_api_router-def456.json    (hash: def456)
```

When file content changes, hash changes → cache miss → re-parse.

## Caching Strategy

### Checkpoint: In-Memory LRU

```typescript
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number = 100;  // Limit memory usage
}
```

**Why LRU?**
- Workflows are hot during a session, cold after
- Bounded memory usage
- Fast access (Map lookup)
- Auto-eviction of old workflows

### Knowledge: TF-IDF Index

```typescript
class LearningSearch {
  private idfCache: Map<string, number>;  // IDF scores
  search(query: string, learnings: LearningRecord[]): LearningRecord[]
}
```

**Why TF-IDF?**
- Fast for <50k documents
- No external dependencies
- Good enough for most use cases
- Can upgrade to FTS5 if needed

### Graph: Content-Hash Cache

```typescript
class GraphCache {
  hashContent(content: string): string;  // SHA-256
  getCacheKey(filepath: string, hash: string): string;
}
```

**Why content-hash?**
- Auto-invalidation on file change
- No explicit cache clearing needed
- Works across git branches
- Deterministic cache keys

## MCP Server Architecture

### Tool Namespacing

All tools are namespaced by subsystem:

```
checkpoint-*    (checkpoint-find, checkpoint-update, checkpoint-complete)
knowledge-*     (knowledge-query, knowledge-store, knowledge-related)
graph-*         (graph-calls, graph-blast, graph-defs)
```

This enables:
- Clear tool ownership
- Easy routing in server
- Progressive disclosure
- Independent versioning

### Request Routing

```typescript
// Unified server routes to subsystems based on prefix
async handleToolCall(name: string, args: object) {
  if (name.startsWith("checkpoint-")) return this.checkpoint.handleToolCall(name, args);
  if (name.startsWith("knowledge-")) return this.knowledge.handleToolCall(name, args);
  if (name.startsWith("graph-")) return this.graph.handleToolCall(name, args);
}
```

### Resources

MCP resources provide browseable views:

```
checkpoint://workflows          → List active workflows
knowledge://learnings/{area}    → Browse learnings by area
graph://entities/{file}         → Entities in a file
```

## Performance Characteristics

### Checkpoint (Workflows)

**Write:** O(1) - append to JSONL file
**Read (cached):** O(1) - Map lookup
**Read (uncached):** O(n) - reconstruct from events (n = event count)

Typical: <10 events per workflow → <1ms reconstruction

### Knowledge (Learnings)

**Write:** O(1) - append to area file
**Search:** O(n*m) - TF-IDF over n documents, m terms

Typical: <5k learnings, <10 terms → <10ms search

### Graph (Code Analysis)

**Parse (cached):** O(1) - read JSON file
**Parse (uncached):** O(n) - ts-morph parse (n = file size)

Typical: 1000-line file → ~50ms parse, <1ms cached

## Scalability Limits

### Checkpoint
- **Max workflows:** 100 (LRU cache limit)
- **Max events/workflow:** ~1000 (reasonable for recovery)
- **Bottleneck:** Event reconstruction (rare, only on cache miss)

### Knowledge
- **Max learnings:** ~50k (TF-IDF limit)
- **Max areas:** unlimited (separate files)
- **Bottleneck:** Search across all learnings (can filter by area)

### Graph
- **Max cached files:** unlimited (disk space)
- **Max file size:** ~10k LOC (ts-morph parse time)
- **Bottleneck:** Initial parse (cached after first run)

## Error Handling

### Graceful Degradation

**Missing file → fresh start:**
```typescript
async read(filename: string): Promise<T[]> {
  if (!existsSync(filepath)) return [];  // Not an error
}
```

**Corrupt file → skip and continue:**
```typescript
try {
  return JSON.parse(line);
} catch {
  return null;  // Filter out later
}
```

**Cache miss → regenerate:**
```typescript
const cached = await cache.read(file, content);
if (!cached) {
  // Parse and cache
}
```

No errors bubble up to Claude Code → no freezing.

## Migration Path

### v1.x → v2.0

```
SQLite tables         →  File-based storage
─────────────────────────────────────────────
workflows             →  .claude/workflows/*.jsonl
entities              →  .claude/learnings/{area}.jsonl
relationships         →  (merged into learnings)
graph_entities        →  .claude/graphs/*.json
```

Migration script:
1. Backup old DB
2. Export to JSONL/JSON
3. Validate counts match
4. Switch MCP server
5. Keep backup for 2 weeks

## Future Enhancements

### Potential Optimizations

**If TF-IDF becomes slow:**
- Add SQLite FTS5 index (single-purpose, read-only)
- Or use dedicated FTS library

**If graph parsing is slow:**
- Incremental parsing (only changed functions)
- Or background parse worker

**If storage grows too large:**
- Compress old learnings (gzip JSONL)
- Or archive to separate directory

### Potential Features

**Workflow Templates:**
- Common workflow patterns
- Auto-fill based on issue type

**Learning Categories:**
- Beyond area/type
- Tags, priorities

**Graph Visualizations:**
- Call graph diagrams
- Blast radius visualization

## Why This Works

**No shared state = no locks**
- Each file is independent
- Append-only writes don't block reads
- In-memory caches are process-local

**Simple is fast**
- JSONL parsing is fast
- Map lookups are O(1)
- TF-IDF is fast for reasonable sizes

**Fail gracefully**
- Missing files = fresh start
- Corrupt data = skip and continue
- Cache misses = regenerate

**Build, measure, optimize**
- Ship working tools first
- Measure real usage
- Optimize bottlenecks when found

This architecture eliminates the v1.x blocking issues while keeping the system simple and maintainable.
