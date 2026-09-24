import { randomUUID } from "node:crypto";
import type {
  CreateTaskInput,
  ListTasksFilter,
  TaskActionResult,
  TaskRecord,
  TaskRecurrence,
  TaskStatus,
} from "./types.js";

export interface TaskRow {
  id: string;
  type: string;
  status: string;
  created_at: string;
  due_at: string;
  recurrence_json: string | null;
  session_id: string;
  description: string;
  actions_json: string;
  result_json: string | null;
  last_error: string | null;
  completed_at: string | null;
  canceled_at: string | null;
}

export function rowToTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    type: row.type as TaskRecord["type"],
    status: row.status as TaskStatus,
    createdAt: row.created_at,
    dueAt: row.due_at,
    recurrence: row.recurrence_json
      ? (JSON.parse(row.recurrence_json) as TaskRecurrence)
      : null,
    sessionId: row.session_id,
    description: row.description,
    actions: JSON.parse(row.actions_json) as TaskRecord["actions"],
    result: row.result_json
      ? (JSON.parse(row.result_json) as TaskActionResult[])
      : null,
    lastError: row.last_error,
    completedAt: row.completed_at,
    canceledAt: row.canceled_at,
  };
}

export interface TaskStatements {
  insertTask: { run: (...params: unknown[]) => unknown };
  selectTask: { get: (...params: unknown[]) => unknown };
  selectTasks: { all: (...params: unknown[]) => unknown };
  selectPendingDue: { all: (...params: unknown[]) => unknown };
  selectNextPending: { get: (...params: unknown[]) => unknown };
  updateTaskStatus: { run: (...params: unknown[]) => unknown };
  updateTaskAfterRun: { run: (...params: unknown[]) => unknown };
  rescheduleRecurring: { run: (...params: unknown[]) => unknown };
}

/** Create prepared statements for task CRUD on an open sqlite connection. */
export function prepareTaskStatements(sqlite: {
  // DatabaseSync.prepare is stricter than we need; keep this boundary loose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare: (sql: string) => any;
}): TaskStatements {
  return {
    insertTask: sqlite.prepare(`
      INSERT INTO tasks (
        id, type, status, created_at, due_at, recurrence_json,
        session_id, description, actions_json, result_json,
        last_error, completed_at, canceled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
    `),
    selectTask: sqlite.prepare(`SELECT * FROM tasks WHERE id = ?`),
    selectTasks: sqlite.prepare(`
      SELECT * FROM tasks
      WHERE (? IS NULL OR session_id = ?)
        AND (? IS NULL OR instr(',' || ? || ',', ',' || status || ',') > 0)
      ORDER BY due_at ASC
      LIMIT ?
    `),
    selectPendingDue: sqlite.prepare(`
      SELECT * FROM tasks
      WHERE status = 'pending' AND due_at <= ?
      ORDER BY due_at ASC
    `),
    selectNextPending: sqlite.prepare(`
      SELECT * FROM tasks
      WHERE status = 'pending'
      ORDER BY due_at ASC
      LIMIT 1
    `),
    updateTaskStatus: sqlite.prepare(`
      UPDATE tasks
      SET status = ?, canceled_at = ?, last_error = ?
      WHERE id = ?
    `),
    updateTaskAfterRun: sqlite.prepare(`
      UPDATE tasks
      SET status = ?, result_json = ?, last_error = ?, completed_at = ?
      WHERE id = ?
    `),
    rescheduleRecurring: sqlite.prepare(`
      UPDATE tasks
      SET status = 'pending',
          due_at = ?,
          result_json = ?,
          last_error = NULL,
          completed_at = ?,
          canceled_at = NULL
      WHERE id = ?
    `),
  };
}

export function createTaskWithStatements(
  stmts: TaskStatements,
  input: CreateTaskInput,
  nowIso: string,
): TaskRecord {
  const id = randomUUID();
  stmts.insertTask.run(
    id,
    input.type,
    "pending",
    nowIso,
    input.dueAt,
    input.recurrence ? JSON.stringify(input.recurrence) : null,
    input.sessionId,
    input.description,
    JSON.stringify(input.actions),
  );
  const row = stmts.selectTask.get(id) as TaskRow;
  return rowToTask(row);
}

export function getTaskWithStatements(
  stmts: TaskStatements,
  id: string,
): TaskRecord | null {
  const row = stmts.selectTask.get(id) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

export function listTasksWithStatements(
  stmts: TaskStatements,
  filter: ListTasksFilter = {},
): TaskRecord[] {
  const statuses = filter.status
    ? Array.isArray(filter.status)
      ? filter.status
      : [filter.status]
    : null;
  const statusCsv = statuses ? statuses.join(",") : null;
  const sessionId = filter.sessionId ?? null;
  const limit = filter.limit ?? 50;
  const rows = stmts.selectTasks.all(
    sessionId,
    sessionId,
    statusCsv,
    statusCsv,
    limit,
  ) as TaskRow[];
  return rows.map(rowToTask);
}

export function listPendingDueWithStatements(
  stmts: TaskStatements,
  beforeIso: string,
): TaskRecord[] {
  const rows = stmts.selectPendingDue.all(beforeIso) as TaskRow[];
  return rows.map(rowToTask);
}

export function getNextPendingWithStatements(
  stmts: TaskStatements,
): TaskRecord | null {
  const row = stmts.selectNextPending.get() as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

export function cancelTaskWithStatements(
  stmts: TaskStatements,
  id: string,
  canceledAtIso: string,
): TaskRecord | null {
  const existing = getTaskWithStatements(stmts, id);
  if (!existing) return null;
  if (existing.status !== "pending" && existing.status !== "running") {
    throw new Error(
      `Cannot cancel task ${id}: status is ${existing.status}`,
    );
  }
  stmts.updateTaskStatus.run("canceled", canceledAtIso, null, id);
  return getTaskWithStatements(stmts, id);
}

export function markTaskRunningWithStatements(
  stmts: TaskStatements,
  id: string,
): void {
  stmts.updateTaskStatus.run("running", null, null, id);
}

export function markTaskFinishedWithStatements(
  stmts: TaskStatements,
  id: string,
  status: "completed" | "failed",
  result: TaskActionResult[],
  lastError: string | null,
  completedAtIso: string,
): TaskRecord | null {
  stmts.updateTaskAfterRun.run(
    status,
    JSON.stringify(result),
    lastError,
    completedAtIso,
    id,
  );
  return getTaskWithStatements(stmts, id);
}

export function rescheduleRecurringWithStatements(
  stmts: TaskStatements,
  id: string,
  nextDueAt: string,
  result: TaskActionResult[],
  completedAtIso: string,
): TaskRecord | null {
  stmts.rescheduleRecurring.run(
    nextDueAt,
    JSON.stringify(result),
    completedAtIso,
    id,
  );
  return getTaskWithStatements(stmts, id);
}
