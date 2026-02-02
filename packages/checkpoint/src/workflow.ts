import { JSONLStorage, type JSONLRecord } from "./storage.ts";
import { LRUCache } from "./cache.ts";

export type WorkflowPhase = "research" | "implement" | "review" | "finalize" | "completed";

export interface WorkflowState {
  id: string;
  issueNumber?: number;
  title: string;
  phase: WorkflowPhase;
  context: string[];
  decisions: string[];
  blockers: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowEvent extends JSONLRecord {
  type: "created" | "phase_change" | "context_added" | "decision_made" | "blocker_added" | "blocker_resolved" | "completed";
  data: Partial<WorkflowState>;
}

/**
 * Workflow manager with JSONL storage and in-memory cache
 */
export class WorkflowManager {
  private storage: JSONLStorage;
  private cache: LRUCache<string, WorkflowState>;

  constructor(storageDir: string, cacheSize: number = 100) {
    this.storage = new JSONLStorage({ baseDir: storageDir });
    this.cache = new LRUCache(cacheSize);
  }

  async init(): Promise<void> {
    await this.storage.init();
  }

  /**
   * Create a new workflow
   */
  async create(params: {
    id: string;
    issueNumber?: number;
    title: string;
    phase?: WorkflowPhase;
  }): Promise<WorkflowState> {
    const now = new Date().toISOString();
    const workflow: WorkflowState = {
      id: params.id,
      issueNumber: params.issueNumber,
      title: params.title,
      phase: params.phase || "research",
      context: [],
      decisions: [],
      blockers: [],
      createdAt: now,
      updatedAt: now,
    };

    const event: WorkflowEvent = {
      timestamp: now,
      type: "created",
      data: workflow,
    };

    await this.storage.write(`${params.id}.jsonl`, [event]);
    this.cache.set(params.id, workflow);

    return workflow;
  }

  /**
   * Get workflow by ID (from cache or disk)
   */
  async get(id: string): Promise<WorkflowState | null> {
    // Check cache first
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }

    // Load from disk and reconstruct state
    const events = await this.storage.read<WorkflowEvent>(`${id}.jsonl`);
    if (events.length === 0) {
      return null;
    }

    const workflow = this.reconstructState(events);
    this.cache.set(id, workflow);

    return workflow;
  }

  /**
   * Update workflow (append event)
   */
  async update(id: string, update: {
    phase?: WorkflowPhase;
    context?: string[];
    decisions?: string[];
    blockers?: string[];
  }): Promise<WorkflowState> {
    const current = await this.get(id);
    if (!current) {
      throw new Error(`Workflow ${id} not found`);
    }

    const now = new Date().toISOString();

    // Merge arrays instead of replacing
    const updated: WorkflowState = {
      ...current,
      phase: update.phase ?? current.phase,
      context: update.context ? [...current.context, ...update.context] : current.context,
      decisions: update.decisions ? [...current.decisions, ...update.decisions] : current.decisions,
      blockers: update.blockers ? [...current.blockers, ...update.blockers] : current.blockers,
      updatedAt: now,
    };

    // Determine event type
    let eventType: WorkflowEvent["type"] = "phase_change";
    if (update.context) eventType = "context_added";
    if (update.decisions) eventType = "decision_made";
    if (update.blockers) eventType = "blocker_added";

    const event: WorkflowEvent = {
      timestamp: now,
      type: eventType,
      data: update,
    };

    await this.storage.append(`${id}.jsonl`, event);
    this.cache.set(id, updated);

    return updated;
  }

  /**
   * Mark workflow as completed and optionally delete
   */
  async complete(id: string, deleteFile: boolean = true): Promise<void> {
    const workflow = await this.get(id);
    if (!workflow) {
      return;
    }

    const now = new Date().toISOString();
    const event: WorkflowEvent = {
      timestamp: now,
      type: "completed",
      data: { phase: "completed" },
    };

    await this.storage.append(`${id}.jsonl`, event);
    this.cache.delete(id);

    if (deleteFile) {
      // Delete after a short delay to allow reading completion event
      setTimeout(() => {
        this.storage.delete(`${id}.jsonl`);
      }, 1000);
    }
  }

  /**
   * List all active workflows
   */
  async list(): Promise<WorkflowState[]> {
    const files = await this.storage.list();
    const workflows: WorkflowState[] = [];

    for (const file of files) {
      const id = file.replace(".jsonl", "");
      const workflow = await this.get(id);
      if (workflow && workflow.phase !== "completed") {
        workflows.push(workflow);
      }
    }

    return workflows;
  }

  /**
   * Find workflow by issue number
   */
  async findByIssue(issueNumber: number): Promise<WorkflowState | null> {
    const workflows = await this.list();
    return workflows.find(w => w.issueNumber === issueNumber) || null;
  }

  /**
   * Reconstruct workflow state from events
   */
  private reconstructState(events: WorkflowEvent[]): WorkflowState {
    let state: WorkflowState | null = null;

    for (const event of events) {
      if (event.type === "created") {
        state = event.data as WorkflowState;
      } else if (state) {
        // Merge arrays when reconstructing
        const update = event.data;
        state = {
          ...state,
          phase: update.phase ?? state.phase,
          context: update.context ? [...state.context, ...update.context] : state.context,
          decisions: update.decisions ? [...state.decisions, ...update.decisions] : state.decisions,
          blockers: update.blockers ? [...state.blockers, ...update.blockers] : state.blockers,
          updatedAt: event.timestamp,
        };
      }
    }

    if (!state) {
      throw new Error("No creation event found");
    }

    return state;
  }
}
