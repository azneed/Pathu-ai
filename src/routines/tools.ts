import { z } from "zod";
import type { ToolDefinition } from "../ai/types.js";
import { validateDeviceAction } from "../ai/deviceActions.js";
import type { DeviceGateway } from "../devices/types.js";
import type { DeviceActionTool } from "../tasks/types.js";
import { DEVICE_ACTION_TOOLS } from "../tasks/types.js";
import type { RoutineService } from "./service.js";
import type { RoutineAction, RoutineRecord } from "./types.js";

const deviceActionSchema = z
  .object({
    tool: z.enum(DEVICE_ACTION_TOOLS),
    arguments: z.record(z.unknown()),
  })
  .strict();

const createRoutineSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    actions: z.array(deviceActionSchema).min(1).max(20),
  })
  .strict();

const updateRoutineSchema = z
  .object({
    routineId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    query: z.string().trim().min(1).optional(),
    newName: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    actions: z.array(deviceActionSchema).min(1).max(20).optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.routineId || value.name || value.query),
    "Provide routineId, name, or query to identify the routine",
  )
  .refine(
    (value) =>
      value.newName !== undefined ||
      value.description !== undefined ||
      value.actions !== undefined,
    "Provide newName, description, and/or actions to update",
  );

const deleteRoutineSchema = z
  .object({
    routineId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    query: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.routineId || value.name || value.query),
    "Provide routineId, name, or query",
  );

const runRoutineSchema = z
  .object({
    routineId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.routineId || value.name),
    "Provide routineId or name",
  );

const listRoutinesSchema = z.object({}).strict();

export const routineToolDefinitions: ToolDefinition[] = [
  {
    name: "list_routines",
    description:
      "List saved home-device routines/scenes including name, description, and actions. Use to answer what a routine contains, or before running/editing by name.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "run_routine",
    description:
      "Execute a saved routine immediately through DeviceGateway. Provide routineId or an unambiguous name. Stops on first failed action. Confirm success only from the tool result.",
    parameters: {
      type: "object",
      properties: {
        routineId: {
          type: "string",
          description: "Exact routine id from list_routines / create_routine",
        },
        name: {
          type: "string",
          description: "Exact routine name (case-insensitive)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_routine",
    description:
      "Create a persistent named routine/scene of validated device actions (set_ac/set_fan/set_lights/set_rgb only). Does not run the routine. Not for YouTube, music, shell, or scheduling.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short routine name" },
        description: {
          type: "string",
          description: "Optional human description",
        },
        actions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              tool: {
                type: "string",
                enum: ["set_ac", "set_fan", "set_lights", "set_rgb"],
              },
              arguments: { type: "object" },
            },
            required: ["tool", "arguments"],
            additionalProperties: false,
          },
        },
      },
      required: ["name", "actions"],
      additionalProperties: false,
    },
  },
  {
    name: "update_routine",
    description:
      "Update an existing routine. Identify with routineId, exact name, or query. Change newName, description, and/or actions (validated set_* only).",
    parameters: {
      type: "object",
      properties: {
        routineId: { type: "string" },
        name: {
          type: "string",
          description: "Exact current name (identifier)",
        },
        query: {
          type: "string",
          description: "Name/substring to find the routine when id unknown",
        },
        newName: { type: "string", description: "Optional renamed title" },
        description: { type: "string" },
        actions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              tool: {
                type: "string",
                enum: ["set_ac", "set_fan", "set_lights", "set_rgb"],
              },
              arguments: { type: "object" },
            },
            required: ["tool", "arguments"],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "delete_routine",
    description:
      "Delete a saved routine by routineId or unambiguous name. Does not change device state.",
    parameters: {
      type: "object",
      properties: {
        routineId: { type: "string" },
        name: { type: "string" },
        query: { type: "string" },
      },
      additionalProperties: false,
    },
  },
];

export const ROUTINE_TOOL_NAMES = routineToolDefinitions.map((t) => t.name);

export interface RoutineToolContext {
  gateway: DeviceGateway;
  routines: RoutineService;
}

function summarizeRoutine(routine: RoutineRecord) {
  return {
    id: routine.id,
    name: routine.name,
    description: routine.description,
    actions: routine.actions,
    createdAt: routine.createdAt,
    updatedAt: routine.updatedAt,
  };
}

function resolveRoutine(
  routines: RoutineService,
  options: { routineId?: string; name?: string; query?: string },
):
  | { ok: true; routine: RoutineRecord }
  | {
      ok: false;
      error: string;
      matches?: Array<{ id: string; name: string }>;
    } {
  if (options.routineId) {
    const routine = routines.get(options.routineId);
    if (!routine) {
      return { ok: false, error: `Routine not found: ${options.routineId}` };
    }
    return { ok: true, routine };
  }

  const exactName = options.name?.trim();
  if (exactName) {
    const matches = routines.findByName(exactName);
    if (matches.length === 1) {
      return { ok: true, routine: matches[0]! };
    }
    if (matches.length === 0) {
      return { ok: false, error: `No routine named "${exactName}".` };
    }
    return {
      ok: false,
      error: `Multiple routines named "${exactName}"; ask which id to use.`,
      matches: matches.map((r) => ({ id: r.id, name: r.name })),
    };
  }

  const query = options.query?.trim().toLowerCase();
  if (!query) {
    return { ok: false, error: "Provide routineId, name, or query" };
  }

  const all = routines.list({ limit: 100 });
  const matches = all.filter(
    (r) =>
      r.name.toLowerCase() === query ||
      r.name.toLowerCase().includes(query) ||
      r.description.toLowerCase().includes(query),
  );

  if (matches.length === 0) {
    return { ok: false, error: `No routine matched query: ${options.query}` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: "Multiple routines matched; ask the user which one.",
      matches: matches.map((r) => ({ id: r.id, name: r.name })),
    };
  }
  return { ok: true, routine: matches[0]! };
}

function validateActions(
  actions: Array<{ tool: string; arguments: Record<string, unknown> }>,
): RoutineAction[] {
  const out: RoutineAction[] = [];
  for (const action of actions) {
    validateDeviceAction(action.tool, action.arguments);
    out.push({
      tool: action.tool as DeviceActionTool,
      arguments: action.arguments,
    });
  }
  return out;
}

export async function executeRoutineTool(
  name: string,
  args: Record<string, unknown>,
  ctx: RoutineToolContext,
): Promise<unknown> {
  switch (name) {
    case "list_routines": {
      listRoutinesSchema.parse(args);
      const routines = ctx.routines.list({ limit: 100 });
      return {
        ok: true,
        count: routines.length,
        routines: routines.map(summarizeRoutine),
      };
    }

    case "run_routine": {
      const parsed = runRoutineSchema.parse(args);
      const resolved = resolveRoutine(ctx.routines, {
        routineId: parsed.routineId,
        name: parsed.name,
      });
      if (!resolved.ok) {
        return resolved;
      }

      const execution = ctx.routines.execute(resolved.routine.id, ctx.gateway);
      return {
        success: execution.success,
        ok: execution.ok,
        routineId: execution.routineId,
        routineName: execution.routineName,
        completedActions: execution.completedActions,
        failedActionIndex: execution.failedActionIndex,
        failedAt: execution.failedAt,
        error: execution.error,
        routine: summarizeRoutine(execution.routine),
        results: execution.results,
        note: execution.success
          ? `Routine "${execution.routineName}" finished ${execution.completedActions} action(s) successfully.`
          : `Routine "${execution.routineName}" stopped after a failed action (completedActions=${execution.completedActions}). Do NOT claim full success.`,
      };
    }

    case "create_routine": {
      const parsed = createRoutineSchema.parse(args);
      const actions = validateActions(parsed.actions);
      const routine = ctx.routines.create({
        name: parsed.name,
        description: parsed.description,
        actions,
      });
      return {
        ok: true,
        routine: summarizeRoutine(routine),
        note: "Routine saved. Devices were not changed; call run_routine to execute.",
      };
    }

    case "update_routine": {
      const parsed = updateRoutineSchema.parse(args);
      const resolved = resolveRoutine(ctx.routines, {
        routineId: parsed.routineId,
        name: parsed.name,
        query: parsed.query,
      });
      if (!resolved.ok) {
        return resolved;
      }

      const routine = ctx.routines.update(resolved.routine.id, {
        name: parsed.newName,
        description: parsed.description,
        actions: parsed.actions
          ? validateActions(parsed.actions)
          : undefined,
      });
      return {
        ok: true,
        routine: summarizeRoutine(routine),
        note: "Routine updated. Devices were not changed unless you also run it.",
      };
    }

    case "delete_routine": {
      const parsed = deleteRoutineSchema.parse(args);
      const resolved = resolveRoutine(ctx.routines, {
        routineId: parsed.routineId,
        name: parsed.name,
        query: parsed.query,
      });
      if (!resolved.ok) {
        return resolved;
      }
      const deleted = ctx.routines.delete(resolved.routine.id);
      return {
        ok: true,
        deleted: summarizeRoutine(deleted),
        note: "Routine deleted. Device state was not changed.",
      };
    }

    default:
      throw new Error(`Unknown routine tool: ${name}`);
  }
}
