# @graph-flow/knowledge

JSONL-based learning persistence with keyword and semantic search. Supports TF-IDF (zero-dependency) and optional OpenAI/OpenRouter embeddings.

## Install

```bash
bun add @graph-flow/knowledge
```

## Usage

```typescript
import { LearningManager } from "@graph-flow/knowledge";

const manager = new LearningManager("/path/to/learnings", "/path/to/embeddings");
await manager.init();

// Store a learning
await manager.store({
  area: "auth",
  type: "pattern",
  content: "JWT tokens are validated in middleware before route handlers",
});

// Query learnings
const results = await manager.query({ text: "authentication", area: "auth" });

// Semantic search (requires OPENAI_API_KEY or OPENROUTER_API_KEY)
const semantic = await manager.query({ text: "how auth works", semantic: true });
```

## License

MIT
