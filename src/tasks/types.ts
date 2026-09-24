export const TASK_TYPES = ["delayed", "scheduled", "recurring"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = [
  "pending",
  "running",
  "completed",
  "canceled",
  "failed",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const DEVICE_ACTION_TOOLS = [
  "set_ac",
  "set_fan",
  "set_lights",
  "set_rgb",
] as const;
export type DeviceActionTool = (typeof DEVICE_ACTION_TOOLS)[number];

export interface TaskAction {
  tool: DeviceActionTool;
  arguments: Record<string, unknown>;
}

export interface TaskActionResult {
  tool: DeviceActionTool;
  arguments: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Practical recurrence: daily or weekly at a local clock time. */
export interface TaskRecurrence {
  frequency: "daily" | "weekly";
  /** Local hour 0-23 in ANDRU_TIMEZONE */
  hour: number;
  /** Local minute 0-59 */
  minute: number;
  /** 0=Sunday … 6=Saturday; required for weekly */
  dayOfWeek?: number;
}

export interface TaskRecord {
  id: string;
  type: TaskType;
  status: TaskStatus;
  createdAt: string;
  dueAt: string;
  recurrence: TaskRecurrence | null;
  sessionId: string;
  description: string;
  actions: TaskAction[];
  result: TaskActionResult[] | null;
  lastError: string | null;
  completedAt: string | null;
  canceledAt: string | null;
}

export interface CreateTaskInput {
  type: TaskType;
  description: string;
  dueAt: string;
  recurrence?: TaskRecurrence | null;
  sessionId: string;
  actions: TaskAction[];
}

export interface ListTasksFilter {
  status?: TaskStatus | TaskStatus[];
  sessionId?: string;
  limit?: number;
}
