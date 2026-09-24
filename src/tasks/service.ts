import type { DeviceGateway } from "../devices/types.js";
import { executeDeviceAction } from "../ai/deviceActions.js";
import { nextOccurrence } from "./time.js";
import type {
  CreateTaskInput,
  ListTasksFilter,
  TaskActionResult,
  TaskRecord,
} from "./types.js";
import {
  cancelTaskWithStatements,
  createTaskWithStatements,
  getNextPendingWithStatements,
  getTaskWithStatements,
  listPendingDueWithStatements,
  listTasksWithStatements,
  markTaskFinishedWithStatements,
  markTaskRunningWithStatements,
  rescheduleRecurringWithStatements,
  type TaskStatements,
} from "./store.js";

export interface TaskService {
  create(input: CreateTaskInput): TaskRecord;
  get(id: string): TaskRecord | null;
  list(filter?: ListTasksFilter): TaskRecord[];
  cancel(id: string): TaskRecord;
  listPendingDue(beforeIso: string): TaskRecord[];
  getNextPending(): TaskRecord | null;
  /** Execute a single pending task via DeviceGateway (no LLM). */
  execute(taskId: string, gateway: DeviceGateway): TaskRecord;
}

export function createTaskService(options: {
  stmts: TaskStatements;
  now?: () => Date;
  timeZone: string;
  onChange?: () => void;
}): TaskService {
  const now = options.now ?? (() => new Date());

  const notify = () => {
    options.onChange?.();
  };

  const service: TaskService = {
    create(input) {
      const task = createTaskWithStatements(
        options.stmts,
        input,
        now().toISOString(),
      );
      notify();
      return task;
    },

    get(id) {
      return getTaskWithStatements(options.stmts, id);
    },

    list(filter) {
      return listTasksWithStatements(options.stmts, filter);
    },

    cancel(id) {
      const task = cancelTaskWithStatements(
        options.stmts,
        id,
        now().toISOString(),
      );
      if (!task) {
        throw new Error(`Task not found: ${id}`);
      }
      notify();
      return task;
    },

    listPendingDue(beforeIso) {
      return listPendingDueWithStatements(options.stmts, beforeIso);
    },

    getNextPending() {
      return getNextPendingWithStatements(options.stmts);
    },

    execute(taskId, gateway) {
      const task = getTaskWithStatements(options.stmts, taskId);
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      if (task.status === "canceled") {
        return task;
      }
      if (task.status !== "pending" && task.status !== "running") {
        return task;
      }

      markTaskRunningWithStatements(options.stmts, taskId);

      const results: TaskActionResult[] = [];
      let allOk = true;

      for (const action of task.actions) {
        try {
          const result = executeDeviceAction(
            action.tool,
            action.arguments,
            gateway,
          );
          results.push({
            tool: action.tool,
            arguments: action.arguments,
            ok: true,
            result,
          });
        } catch (error) {
          allOk = false;
          const message =
            error instanceof Error ? error.message : String(error);
          results.push({
            tool: action.tool,
            arguments: action.arguments,
            ok: false,
            error: message,
          });
        }
      }

      const finishedAt = now().toISOString();

      if (!allOk) {
        const lastError = results
          .filter((r) => !r.ok)
          .map((r) => `${r.tool}: ${r.error}`)
          .join("; ");
        const updated = markTaskFinishedWithStatements(
          options.stmts,
          taskId,
          "failed",
          results,
          lastError,
          finishedAt,
        );
        notify();
        return updated!;
      }

      if (task.type === "recurring" && task.recurrence) {
        const after = new Date(
          Math.max(now().getTime(), new Date(task.dueAt).getTime()),
        );
        const nextDue = nextOccurrence(
          task.recurrence,
          options.timeZone,
          after,
        );
        const updated = rescheduleRecurringWithStatements(
          options.stmts,
          taskId,
          nextDue.toISOString(),
          results,
          finishedAt,
        );
        notify();
        return updated!;
      }

      const updated = markTaskFinishedWithStatements(
        options.stmts,
        taskId,
        "completed",
        results,
        null,
        finishedAt,
      );
      notify();
      return updated!;
    },
  };

  return service;
}
