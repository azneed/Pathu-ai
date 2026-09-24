import type {
  DeviceActionTool,
  TaskAction,
  TaskActionResult,
} from "../tasks/types.js";

/** Reuse the same validated device-action shape as tasks. */
export type RoutineAction = TaskAction;
export type RoutineActionResult = TaskActionResult;
export type { DeviceActionTool };

export interface RoutineRecord {
  id: string;
  name: string;
  description: string;
  actions: RoutineAction[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoutineInput {
  name: string;
  description?: string;
  actions: RoutineAction[];
}

export interface UpdateRoutineInput {
  name?: string;
  description?: string;
  actions?: RoutineAction[];
}

export interface ListRoutinesFilter {
  limit?: number;
}

export interface RoutineExecutionResult {
  /** Spec alias for truthful overall success. */
  success: boolean;
  /** Same as success (existing Andru convention). */
  ok: boolean;
  routineId: string;
  routineName: string;
  /** Number of actions that completed successfully before stop/end. */
  completedActions: number;
  /** 0-based index of the first failed action, if any. */
  failedActionIndex?: number;
  /** @deprecated Prefer failedActionIndex; kept for older callers. */
  failedAt?: number;
  error?: string;
  routine: RoutineRecord;
  results: RoutineActionResult[];
}
