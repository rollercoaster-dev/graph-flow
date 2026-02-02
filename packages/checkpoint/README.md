# @graph-flow/checkpoint

JSONL-based workflow checkpoint and recovery system. Tracks workflow state, actions, and commits with append-only storage.

## Install

```bash
bun add @graph-flow/checkpoint
```

## Usage

```typescript
import { WorkflowManager } from "@graph-flow/checkpoint";

const manager = new WorkflowManager("/path/to/workflows");
await manager.init();

// Create a workflow
const workflow = await manager.create({ issue: 42 });

// Update phase
await manager.updatePhase(workflow.id, "implement");

// Log an action
await manager.logAction(workflow.id, {
  tool: "edit",
  file: "src/index.ts",
  summary: "Fix null check",
});
```

## License

MIT
