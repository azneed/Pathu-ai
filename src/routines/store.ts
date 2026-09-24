import { randomUUID } from "node:crypto";
import type {
  CreateRoutineInput,
  ListRoutinesFilter,
  RoutineRecord,
  UpdateRoutineInput,
} from "./types.js";

export interface RoutineRow {
  id: string;
  name: string;
  description: string;
  actions_json: string;
  created_at: string;
  updated_at: string;
}

export function rowToRoutine(row: RoutineRow): RoutineRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    actions: JSON.parse(row.actions_json) as RoutineRecord["actions"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface RoutineStatements {
  insertRoutine: { run: (...params: unknown[]) => unknown };
  selectRoutine: { get: (...params: unknown[]) => unknown };
  selectRoutines: { all: (...params: unknown[]) => unknown };
  selectByNameLower: { all: (...params: unknown[]) => unknown };
  updateRoutine: { run: (...params: unknown[]) => unknown };
  deleteRoutine: { run: (...params: unknown[]) => unknown };
}

export function prepareRoutineStatements(sqlite: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare: (sql: string) => any;
}): RoutineStatements {
  return {
    insertRoutine: sqlite.prepare(`
      INSERT INTO routines (
        id, name, description, actions_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `),
    selectRoutine: sqlite.prepare(`SELECT * FROM routines WHERE id = ?`),
    selectRoutines: sqlite.prepare(`
      SELECT * FROM routines
      ORDER BY lower(name) ASC
      LIMIT ?
    `),
    selectByNameLower: sqlite.prepare(`
      SELECT * FROM routines
      WHERE lower(name) = lower(?)
      ORDER BY created_at ASC
    `),
    updateRoutine: sqlite.prepare(`
      UPDATE routines
      SET name = ?, description = ?, actions_json = ?, updated_at = ?
      WHERE id = ?
    `),
    deleteRoutine: sqlite.prepare(`DELETE FROM routines WHERE id = ?`),
  };
}

export function createRoutineWithStatements(
  stmts: RoutineStatements,
  input: CreateRoutineInput,
  nowIso: string,
): RoutineRecord {
  const id = randomUUID();
  stmts.insertRoutine.run(
    id,
    input.name.trim(),
    (input.description ?? "").trim(),
    JSON.stringify(input.actions),
    nowIso,
    nowIso,
  );
  const row = stmts.selectRoutine.get(id) as RoutineRow;
  return rowToRoutine(row);
}

export function getRoutineWithStatements(
  stmts: RoutineStatements,
  id: string,
): RoutineRecord | null {
  const row = stmts.selectRoutine.get(id) as RoutineRow | undefined;
  return row ? rowToRoutine(row) : null;
}

export function listRoutinesWithStatements(
  stmts: RoutineStatements,
  filter: ListRoutinesFilter = {},
): RoutineRecord[] {
  const limit = filter.limit ?? 100;
  const rows = stmts.selectRoutines.all(limit) as RoutineRow[];
  return rows.map(rowToRoutine);
}

export function findRoutinesByNameWithStatements(
  stmts: RoutineStatements,
  name: string,
): RoutineRecord[] {
  const rows = stmts.selectByNameLower.all(name.trim()) as RoutineRow[];
  return rows.map(rowToRoutine);
}

export function updateRoutineWithStatements(
  stmts: RoutineStatements,
  id: string,
  current: RoutineRecord,
  patch: UpdateRoutineInput,
  nowIso: string,
): RoutineRecord | null {
  const name = patch.name !== undefined ? patch.name.trim() : current.name;
  const description =
    patch.description !== undefined
      ? patch.description.trim()
      : current.description;
  const actions = patch.actions ?? current.actions;
  stmts.updateRoutine.run(
    name,
    description,
    JSON.stringify(actions),
    nowIso,
    id,
  );
  return getRoutineWithStatements(stmts, id);
}

export function deleteRoutineWithStatements(
  stmts: RoutineStatements,
  id: string,
): boolean {
  const existing = getRoutineWithStatements(stmts, id);
  if (!existing) return false;
  stmts.deleteRoutine.run(id);
  return true;
}
