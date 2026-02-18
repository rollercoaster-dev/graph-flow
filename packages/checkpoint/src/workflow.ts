import { LRUCache } from "./cache.ts";
import { type JSONLRecord, JSONLStorage } from "./storage.ts";

export type WorkflowPhase =
  | "research"
  | "implement"
  | "review"
  | "finalize" // issue workflows
  | "planning"
  | "execute"
  | "merge"
  | "cleanup" // milestone workflows
  | "completed";

export type WorkflowStatus = "running" | "paused" | "completed" | "failed";

export interface WorkflowAction {
  action: string;
  result: "success" | "failed" | "pending";
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface WorkflowCommit {
  sha: string;
  message: string;
  timestamp: string;
}

export interface RecoveryPlan {
  workflow: WorkflowState;
  resumePhase: WorkflowPhase;
  pendingActions: WorkflowAction[];
  lastCommit: WorkflowCommit | null;
  summary: string;
}

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
  branch?: string;
  worktree?: string;
  status: WorkflowStatus;
  retryCount: number;
  taskId?: string;
  actions: WorkflowAction[];
  commits: WorkflowCommit[];
}

export interface WorkflowEvent extends JSONLRecord {
  type:
    | "created"
    | "phase_change"
    | "context_added"
    | "decision_made"
    | "blocker_added"
    | "blocker_resolved"
    | "completed"
    | "status_changed"
    | "action_logged"
    | "commit_logged";
  data: Partial<WorkflowState> & {
    logAction?: WorkflowAction;
    logCommit?: WorkflowCommit;
  };
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

  private assertSafeId(id: string): void {
    const trimmed = id.trim();
    const isSafe =
      trimmed.length > 0 &&
      !trimmed.includes("..") &&
      !trimmed.includes("/") &&
      !trimmed.includes("\\");
    if (!isSafe) {
      throw new Error(`Invalid workflow id: ${id}`);
    }
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
    branch?: string;
    worktree?: string;
    status?: WorkflowStatus;
    taskId?: string;
  }): Promise<WorkflowState> {
    this.assertSafeId(params.id);
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
      branch: params.branch,
      worktree: params.worktree,
      status: params.status || "running",
      retryCount: 0,
      taskId: params.taskId,
      actions: [],
      commits: [],
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
    this.assertSafeId(id);
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
  async update(
    id: string,
    update: {
      phase?: WorkflowPhase;
      context?: string[];
      decisions?: string[];
      blockers?: string[];
      status?: WorkflowStatus;
      branch?: string;
      worktree?: string;
      taskId?: string;
      logAction?: WorkflowAction;
      logCommit?: WorkflowCommit;
    },
  ): Promise<WorkflowState> {
    this.assertSafeId(id);
    const current = await this.get(id);
    if (!current) {
      throw new Error(`Workflow ${id} not found`);
    }

    const now = new Date().toISOString();

    // Merge arrays instead of replacing
    const updated: WorkflowState = {
      ...current,
      phase: update.phase ?? current.phase,
      context: update.context
        ? [...current.context, ...update.context]
        : current.context,
      decisions: update.decisions
        ? [...current.decisions, ...update.decisions]
        : current.decisions,
      blockers: update.blockers
        ? [...current.blockers, ...update.blockers]
        : current.blockers,
      status: update.status ?? current.status,
      branch: update.branch ?? current.branch,
      worktree: update.worktree ?? current.worktree,
      taskId: update.taskId ?? current.taskId,
      actions: update.logAction
        ? [...current.actions, update.logAction]
        : current.actions,
      commits: update.logCommit
        ? [...current.commits, update.logCommit]
        : current.commits,
      retryCount:
        update.status === "failed"
          ? current.retryCount + 1
          : current.retryCount,
      updatedAt: now,
    };

    // Determine event type (priority: logCommit > logAction > status > blocker > decision > context > phase)
    let eventType: WorkflowEvent["type"] = "phase_change";
    if (update.context) eventType = "context_added";
    if (update.decisions) eventType = "decision_made";
    if (update.blockers) eventType = "blocker_added";
    if (update.status) eventType = "status_changed";
    if (update.logAction) eventType = "action_logged";
    if (update.logCommit) eventType = "commit_logged";

    const event: WorkflowEvent = {
      timestamp: now,
      type: eventType,
      data: {
        ...update,
        logAction: update.logAction,
        logCommit: update.logCommit,
      },
    };

    await this.storage.append(`${id}.jsonl`, event);
    this.cache.set(id, updated);

    return updated;
  }

  /**
   * Mark workflow as completed and optionally delete
   */
  async complete(id: string, deleteFile: boolean = true): Promise<void> {
    this.assertSafeId(id);
    const workflow = await this.get(id);
    if (!workflow) {
      return;
    }

    const now = new Date().toISOString();
    const event: WorkflowEvent = {
      timestamp: now,
      type: "completed",
      data: { phase: "completed", status: "completed" },
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
      if (
        workflow &&
        workflow.phase !== "completed" &&
        workflow.status !== "completed"
      ) {
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
    return workflows.find((w) => w.issueNumber === issueNumber) || null;
  }

  /**
   * Build a recovery plan for resuming a workflow after interruption
   */
  async recover(id: string): Promise<RecoveryPlan | null> {
    this.assertSafeId(id);
    // Read directly from disk, bypassing cache for freshest state
    const events = await this.storage.read<WorkflowEvent>(`${id}.jsonl`);
    if (events.length === 0) {
      return null;
    }

    const workflow = this.reconstructState(events);
    const pendingActions = workflow.actions.filter(
      (a) => a.result === "pending",
    );
    const lastCommit =
      workflow.commits.length > 0
        ? workflow.commits[workflow.commits.length - 1]
        : null;

    const parts: string[] = [
      `Workflow "${workflow.title}" (${workflow.id})`,
      `Phase: ${workflow.phase}, Status: ${workflow.status}`,
    ];
    if (workflow.branch) parts.push(`Branch: ${workflow.branch}`);
    if (lastCommit)
      parts.push(
        `Last commit: ${lastCommit.sha.substring(0, 7)} - ${lastCommit.message}`,
      );
    if (pendingActions.length > 0)
      parts.push(`${pendingActions.length} pending action(s) to resume`);
    if (workflow.blockers.length > 0)
      parts.push(`${workflow.blockers.length} blocker(s) present`);
    if (workflow.retryCount > 0)
      parts.push(`Retry count: ${workflow.retryCount}`);

    return {
      workflow,
      resumePhase: workflow.phase,
      pendingActions,
      lastCommit,
      summary: `${parts.join(". ")}.`,
    };
  }

  /**
   * Reconstruct workflow state from events
   */
  private reconstructState(events: WorkflowEvent[]): WorkflowState {
    let state: WorkflowState | null = null;

    for (const event of events) {
      if (event.type === "created") {
        const data = event.data as WorkflowState;
        // Backward compat: ensure new fields have defaults for old events
        state = {
          ...data,
          status: data.status ?? "running",
          retryCount: data.retryCount ?? 0,
          actions: data.actions ?? [],
          commits: data.commits ?? [],
        };
      } else if (state) {
        const current: WorkflowState = state;
        const update = event.data;
        state = {
          ...current,
          phase: update.phase ?? current.phase,
          context: update.context
            ? [...current.context, ...update.context]
            : current.context,
          decisions: update.decisions
            ? [...current.decisions, ...update.decisions]
            : current.decisions,
          blockers: update.blockers
            ? [...current.blockers, ...update.blockers]
            : current.blockers,
          status: update.status ?? current.status,
          branch: update.branch ?? current.branch,
          worktree: update.worktree ?? current.worktree,
          taskId: update.taskId ?? current.taskId,
          updatedAt: event.timestamp,
        };

        // Handle action_logged events
        if (event.type === "action_logged" && update.logAction) {
          // biome-ignore lint/style/noNonNullAssertion: state is assigned above
          state!.actions = [...state!.actions, update.logAction];
        }

        // Handle commit_logged events
        if (event.type === "commit_logged" && update.logCommit) {
          // biome-ignore lint/style/noNonNullAssertion: state is assigned above
          state!.commits = [...state!.commits, update.logCommit];
        }

        // Handle status_changed: increment retryCount on failure
        if (event.type === "status_changed" && update.status === "failed") {
          // biome-ignore lint/style/noNonNullAssertion: state is assigned above
          state!.retryCount = (state!.retryCount ?? 0) + 1;
        }
      }
    }

    if (!state) {
      throw new Error("No creation event found");
    }

    return state;
  }
}
