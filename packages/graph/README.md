# @graph-flow/graph

Code graph analysis with hash-based caching. Parses TypeScript/JavaScript files to extract entities, call graphs, and relationships.

## Install

```bash
bun add @graph-flow/graph
```

## Usage

```typescript
import { GraphQuery } from "@graph-flow/graph";

const query = new GraphQuery("/path/to/cache");
await query.init();

// Get all definitions in a file
const defs = await query.getDefinitions("src/index.ts");

// Find what calls a function (supports glob patterns)
const callers = await query.whatCalls("handleRequest", ["src/**/*.ts"]);

// Calculate blast radius
const impact = await query.blastRadius("authenticate", ["src/**/*.ts"], 3);
```

## License

MIT
