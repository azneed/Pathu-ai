import { executeDeviceAction } from "../ai/deviceActions.js";
import type { DeviceGateway } from "../devices/types.js";
import type {
  CreateRoutineInput,
  ListRoutinesFilter,
  RoutineActionResult,
  RoutineExecutionResult,
  RoutineRecord,
  UpdateRoutineInput,
} from "./types.js";
import {
  createRoutineWithStatements,
  deleteRoutineWithStatements,
  findRoutinesByNameWithStatements,
  getRoutineWithStatements,
  listRoutinesWithStatements,
  updateRoutineWithStatements,
  type RoutineStatements,
} from "./store.js";

export interface RoutineService {
  create(input: CreateRoutineInput): RoutineRecord;
  get(id: string): RoutineRecord | null;
  list(filter?: ListRoutinesFilter): RoutineRecord[];
  /** Case-insensitive exact name match (may return multiple if duplicates). */
  findByName(name: string): RoutineRecord[];
  update(id: string, patch: UpdateRoutineInput): RoutineRecord;
  delete(id: string): RoutineRecord;
  /**
   * Execute actions in order via DeviceGateway.
   * Stops on the first failure (unlike TaskService.execute).
   */
  execute(id: string, gateway: DeviceGateway): Promise<RoutineExecutionResult>;
}

export function createRoutineService(options: {
  stmts: RoutineStatements;
  now?: () => Date;
}): RoutineService {
  const now = options.now ?? (() => new Date());

  const service: RoutineService = {
    create(input) {
      const name = input.name.trim();
      if (!name) {
        throw new Error("Routine name is required");
      }
      if (!input.actions.length) {
        throw new Error("Routine requires at least one action");
      }
      return createRoutineWithStatements(
        options.stmts,
        { ...input, name },
        now().toISOString(),
      );
    },

    get(id) {
      return getRoutineWithStatements(options.stmts, id);
    },

    list(filter) {
      return listRoutinesWithStatements(options.stmts, filter);
    },

    findByName(name) {
      const trimmed = name.trim();
      if (!trimmed) return [];
      return findRoutinesByNameWithStatements(options.stmts, trimmed);
    },

    update(id, patch) {
      const current = getRoutineWithStatements(options.stmts, id);
      if (!current) {
        throw new Error(`Routine not found: ${id}`);
      }
      if (patch.name !== undefined && !patch.name.trim()) {
        throw new Error("Routine name cannot be empty");
      }
      if (patch.actions !== undefined && patch.actions.length === 0) {
        throw new Error("Routine requires at least one action");
      }
      const updated = updateRoutineWithStatements(
        options.stmts,
        id,
        current,
        patch,
        now().toISOString(),
      );
      if (!updated) {
        throw new Error(`Routine not found: ${id}`);
      }
      return updated;
    },

    delete(id) {
      const current = getRoutineWithStatements(options.stmts, id);
      if (!current) {
        throw new Error(`Routine not found: ${id}`);
      }
      deleteRoutineWithStatements(options.stmts, id);
      return current;
    },

    async execute(id, gateway) {
      const routine = getRoutineWithStatements(options.stmts, id);
      if (!routine) {
        throw new Error(`Routine not found: ${id}`);
      }

      // Defensive: empty action lists are rejected on create/update, but still
      // return a truthful no-op success if encountered.
      if (routine.actions.length === 0) {
        return {
          success: true,
          ok: true,
          routineId: routine.id,
          routineName: routine.name,
          completedActions: 0,
          routine,
          results: [],
        };
      }

      const results: RoutineActionResult[] = [];

      for (let i = 0; i < routine.actions.length; i += 1) {
        const action = routine.actions[i]!;
        try {
          const result = await executeDeviceAction(
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
          const message =
            error instanceof Error ? error.message : String(error);
          results.push({
            tool: action.tool,
            arguments: action.arguments,
            ok: false,
            error: message,
          });
          return {
            success: false,
            ok: false,
            routineId: routine.id,
            routineName: routine.name,
            completedActions: i,
            failedActionIndex: i,
            failedAt: i,
            error: `Action ${i + 1} (${action.tool}) failed: ${message}`,
            routine,
            results,
          };
        }
      }

      return {
        success: true,
        ok: true,
        routineId: routine.id,
        routineName: routine.name,
        completedActions: results.length,
        routine,
        results,
      };
    },
  };

  return service;
}
