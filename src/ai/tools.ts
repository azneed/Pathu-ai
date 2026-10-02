import {
  executeYoutubeTool,
  YOUTUBE_TOOL_NAMES,
  youtubeToolDefinitions,
} from "../youtube/tools.js";
import {
  executeMusicTool,
  MUSIC_TOOL_NAMES,
  musicToolDefinitions,
} from "../music/tools.js";
import {
  executeRoutineTool,
  ROUTINE_TOOL_NAMES,
  routineToolDefinitions,
} from "../routines/tools.js";
import type { RoutineService } from "../routines/service.js";
import type { ToolDefinition } from "./types.js";
import {
  executeDeviceAction,
  setAcSchema,
  setFanSchema,
  setLightsSchema,
  setRgbSchema,
  validateDeviceAction,
} from "./deviceActions.js";
import type { DeviceGateway } from "../devices/types.js";
import type { TaskService } from "../tasks/service.js";
import {
  describeCurrentTime,
  formatInstantForZone,
  nextOccurrence,
  parseDueAt,
} from "../tasks/time.js";
import type { DeviceActionTool, TaskAction } from "../tasks/types.js";
import { DEVICE_ACTION_TOOLS } from "../tasks/types.js";
import { z } from "zod";

const deviceActionSchema = z
  .object({
    tool: z.enum(DEVICE_ACTION_TOOLS),
    arguments: z.record(z.unknown()),
  })
  .strict();

const recurrenceSchema = z
  .object({
    frequency: z.enum(["daily", "weekly"]),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.frequency === "weekly" && value.dayOfWeek === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "weekly recurrence requires dayOfWeek (0=Sunday … 6=Saturday)",
      });
    }
  });

const createTaskSchema = z
  .object({
    description: z.string().trim().min(1),
    type: z.enum(["delayed", "scheduled", "recurring"]),
    delaySeconds: z.number().positive().optional(),
    dueAt: z.string().trim().min(1).optional(),
    recurrence: recurrenceSchema.optional(),
    actions: z.array(deviceActionSchema).min(1),
  })
  .strict();

const cancelTaskSchema = z
  .object({
    taskId: z.string().trim().min(1).optional(),
    query: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.taskId || value.query),
    "Provide taskId or query",
  );

const getTasksSchema = z
  .object({
    status: z
      .enum(["pending", "running", "completed", "canceled", "failed"])
      .optional(),
    includeCompleted: z.boolean().optional(),
  })
  .strict();

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "get_current_time",
    description:
      "Return the real current local date and time from the Pathu server clock in the application timezone. Use for 'what time is it', 'what's the date/day today', and before reasoning about relative times. Never guess the time.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_devices",
    description:
      "Return authoritative current state for all bedroom devices: bedroom.ac, bedroom.fan, bedroom.lights, bedroom.rgb. Prefer the provided CURRENT DEVICE STATE snapshot for simple status questions; use this tool if you need an explicit refresh.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "set_ac",
    description:
      "Control bedroom.ac (air conditioner only) immediately. Use for cooling/heating the room temperature. Not the standalone fan. For future/delayed changes use create_task.",
    parameters: {
      type: "object",
      properties: {
        power: {
          type: "string",
          enum: ["on", "off"],
          description: "AC power",
        },
        temperature: {
          type: "integer",
          minimum: 16,
          maximum: 30,
          description: "Target temperature in Celsius (16-30)",
        },
        mode: {
          type: "string",
          enum: ["cool", "heat", "fan", "auto", "dry"],
          description: "AC operating mode",
        },
        fanSpeed: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          description: "AC internal fan speed 1-5 (not bedroom.fan)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "set_fan",
    description:
      "Control bedroom.fan (standalone ceiling/room fan) immediately. Use for fan speed up/down. Not AC fanSpeed. For future/delayed changes use create_task.",
    parameters: {
      type: "object",
      properties: {
        power: {
          type: "string",
          enum: ["on", "off"],
          description: "Fan power",
        },
        speed: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          description: "Fan speed 1-5",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "set_lights",
    description:
      "Control bedroom.lights (main white/room lights) immediately. Brightness only — no color. For colored light use set_rgb on bedroom.rgb. For future/delayed changes use create_task.",
    parameters: {
      type: "object",
      properties: {
        power: {
          type: "string",
          enum: ["on", "off"],
          description: "Main lights power",
        },
        brightness: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Brightness percent 0-100",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "set_rgb",
    description:
      "Control bedroom.rgb (RGB accent light only) immediately. Supports color. Do not use for main bedroom.lights. For future/delayed changes use create_task.",
    parameters: {
      type: "object",
      properties: {
        power: {
          type: "string",
          enum: ["on", "off"],
          description: "RGB light power",
        },
        brightness: {
          type: "integer",
          minimum: 0,
          maximum: 100,
          description: "Brightness percent 0-100",
        },
        color: {
          type: "object",
          description:
            "RGB color channels 0-255. Map named colors (red={255,0,0}).",
          properties: {
            r: { type: "integer", minimum: 0, maximum: 255 },
            g: { type: "integer", minimum: 0, maximum: 255 },
            b: { type: "integer", minimum: 0, maximum: 255 },
          },
          required: ["r", "g", "b"],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_task",
    description:
      "Schedule a future device action. Use for delayed/scheduled/recurring requests (e.g. 'in 5 minutes', 'at 11 PM', 'every day at 6 PM'). Convert relative phrases to delaySeconds or an absolute dueAt. Convert clock times using the application timezone. Do NOT call set_* tools for the future action — only create_task. Confirm scheduling only; do not claim devices already changed. Actions must use set_ac/set_fan/set_lights/set_rgb with the same argument shapes as those tools.",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Short human-readable summary of the scheduled work",
        },
        type: {
          type: "string",
          enum: ["delayed", "scheduled", "recurring"],
        },
        delaySeconds: {
          type: "number",
          description:
            "Seconds from now until execution (preferred for 'in N minutes/hours')",
        },
        dueAt: {
          type: "string",
          description:
            "Absolute due time as ISO-8601. Naive local datetimes are interpreted in the app timezone; prefer including an offset when known.",
        },
        recurrence: {
          type: "object",
          description: "Required for recurring tasks",
          properties: {
            frequency: { type: "string", enum: ["daily", "weekly"] },
            hour: { type: "integer", minimum: 0, maximum: 23 },
            minute: { type: "integer", minimum: 0, maximum: 59 },
            dayOfWeek: {
              type: "integer",
              minimum: 0,
              maximum: 6,
              description: "0=Sunday … 6=Saturday; required when frequency=weekly",
            },
          },
          required: ["frequency", "hour", "minute"],
          additionalProperties: false,
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
              arguments: {
                type: "object",
                description: "Same arguments as the corresponding set_* tool",
              },
            },
            required: ["tool", "arguments"],
            additionalProperties: false,
          },
        },
      },
      required: ["description", "type", "actions"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel_task",
    description:
      "Cancel a pending scheduled/delayed/recurring task. Prefer taskId from get_tasks. If the user says 'cancel my AC timer', pass a query like 'AC' to match pending tasks.",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Exact task id from get_tasks / create_task",
        },
        query: {
          type: "string",
          description:
            "Free-text match against pending task descriptions (e.g. 'AC', 'lights')",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_tasks",
    description:
      "List persisted tasks from the task store (not conversation memory). Use for 'what tasks do I have', 'what's scheduled', 'when will the AC turn off'.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "running", "completed", "canceled", "failed"],
          description: "Optional status filter",
        },
        includeCompleted: {
          type: "boolean",
          description:
            "If true and status omitted, include completed/canceled/failed as well as pending",
        },
      },
      additionalProperties: false,
    },
  },
  ...youtubeToolDefinitions,
  ...musicToolDefinitions,
  ...routineToolDefinitions,
];

export interface ToolContext {
  gateway: DeviceGateway;
  tasks: TaskService;
  routines?: RoutineService;
  timeZone: string;
  sessionId: string;
  now?: () => Date;
  youtubeApiKey?: string;
  audiusApiKey?: string;
  fetchImpl?: typeof fetch;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext | DeviceGateway,
): Promise<unknown> {
  // Back-compat: older call sites passed gateway only.
  const ctx: ToolContext =
    "getAll" in context && !("tasks" in context)
      ? {
          gateway: context,
          tasks: null as unknown as TaskService,
          timeZone: "UTC",
          sessionId: "default",
        }
      : (context as ToolContext);

  if ((YOUTUBE_TOOL_NAMES as string[]).includes(name)) {
    return executeYoutubeTool(name, args, {
      sessionId: ctx.sessionId,
      youtubeApiKey: ctx.youtubeApiKey ?? "",
      fetchImpl: ctx.fetchImpl,
    });
  }

  if ((MUSIC_TOOL_NAMES as string[]).includes(name)) {
    return executeMusicTool(name, args, {
      sessionId: ctx.sessionId,
      audiusApiKey: ctx.audiusApiKey ?? "",
      fetchImpl: ctx.fetchImpl,
    });
  }

  if ((ROUTINE_TOOL_NAMES as string[]).includes(name)) {
    if (!ctx.routines) {
      throw new Error("Routine service is not available");
    }
    return executeRoutineTool(name, args, {
      gateway: ctx.gateway,
      routines: ctx.routines,
    });
  }

  switch (name) {
    case "get_current_time": {
      z.object({}).strict().parse(args);
      return describeCurrentTime((ctx.now ?? (() => new Date()))(), ctx.timeZone);
    }

    case "get_devices":
      return ctx.gateway.getAll();

    case "set_ac": {
      const command = setAcSchema.parse(args);
      return ctx.gateway.set("bedroom.ac", command);
    }

    case "set_fan": {
      const command = setFanSchema.parse(args);
      return ctx.gateway.set("bedroom.fan", command);
    }

    case "set_lights": {
      const command = setLightsSchema.parse(args);
      return ctx.gateway.set("bedroom.lights", command);
    }

    case "set_rgb": {
      const command = setRgbSchema.parse(args);
      return ctx.gateway.set("bedroom.rgb", command);
    }

    case "create_task":
      return createTaskTool(args, ctx);

    case "cancel_task":
      return cancelTaskTool(args, ctx);

    case "get_tasks":
      return getTasksTool(args, ctx);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function createTaskTool(args: Record<string, unknown>, ctx: ToolContext) {
  if (!ctx.tasks) {
    throw new Error("Task service is not available");
  }
  const parsed = createTaskSchema.parse(args);
  const now = ctx.now ?? (() => new Date());
  const current = now();

  for (const action of parsed.actions) {
    validateDeviceAction(action.tool, action.arguments);
  }

  let dueAt: Date;
  let recurrence = parsed.recurrence ?? null;

  if (parsed.type === "recurring") {
    if (!recurrence) {
      throw new Error("recurring tasks require a recurrence object");
    }
    dueAt = parsed.dueAt
      ? parseDueAt(parsed.dueAt, ctx.timeZone)
      : nextOccurrence(recurrence, ctx.timeZone, current);
  } else if (parsed.delaySeconds !== undefined) {
    dueAt = new Date(current.getTime() + parsed.delaySeconds * 1000);
  } else if (parsed.dueAt) {
    dueAt = parseDueAt(parsed.dueAt, ctx.timeZone);
  } else {
    throw new Error("Provide delaySeconds or dueAt");
  }

  if (Number.isNaN(dueAt.getTime())) {
    throw new Error("Invalid due time");
  }

  // Past times: reject clearly for one-shot; recurring still uses nextOccurrence.
  if (parsed.type !== "recurring" && dueAt.getTime() < current.getTime() - 5000) {
    throw new Error(
      `dueAt is in the past (${dueAt.toISOString()}). Ask the user for a future time.`,
    );
  }

  const actions: TaskAction[] = parsed.actions.map((action) => ({
    tool: action.tool as DeviceActionTool,
    arguments: action.arguments,
  }));

  const task = ctx.tasks.create({
    type: parsed.type,
    description: parsed.description,
    dueAt: dueAt.toISOString(),
    recurrence,
    sessionId: ctx.sessionId,
    actions,
  });

  return {
    ok: true,
    task: {
      id: task.id,
      type: task.type,
      status: task.status,
      description: task.description,
      dueAt: task.dueAt,
      dueAtLocal: formatInstantForZone(new Date(task.dueAt), ctx.timeZone),
      recurrence: task.recurrence,
      actions: task.actions,
    },
    note: "Task created. Devices have not changed yet; execution happens at dueAt.",
  };
}

function cancelTaskTool(args: Record<string, unknown>, ctx: ToolContext) {
  if (!ctx.tasks) {
    throw new Error("Task service is not available");
  }
  const parsed = cancelTaskSchema.parse(args);
  const pending = ctx.tasks.list({ status: "pending", limit: 50 });

  if (parsed.taskId) {
    const canceled = ctx.tasks.cancel(parsed.taskId);
    return { ok: true, canceled };
  }

  const query = (parsed.query ?? "").toLowerCase();
  const matches = pending.filter((task) =>
    task.description.toLowerCase().includes(query),
  );

  if (matches.length === 0) {
    return {
      ok: false,
      error: `No pending task matched query: ${parsed.query}`,
      pending,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: "Multiple pending tasks matched; ask the user which one to cancel.",
      matches: matches.map((t) => ({
        id: t.id,
        description: t.description,
        dueAt: t.dueAt,
      })),
    };
  }

  const canceled = ctx.tasks.cancel(matches[0]!.id);
  return { ok: true, canceled };
}

function getTasksTool(args: Record<string, unknown>, ctx: ToolContext) {
  if (!ctx.tasks) {
    throw new Error("Task service is not available");
  }
  const parsed = getTasksSchema.parse(args);

  let tasks;
  if (parsed.status) {
    tasks = ctx.tasks.list({ status: parsed.status, limit: 50 });
  } else if (parsed.includeCompleted) {
    tasks = ctx.tasks.list({ limit: 50 });
  } else {
    tasks = ctx.tasks.list({
      status: ["pending", "running"],
      limit: 50,
    });
  }

  return {
    timeZone: ctx.timeZone,
    tasks: tasks.map((task) => ({
      id: task.id,
      type: task.type,
      status: task.status,
      description: task.description,
      dueAt: task.dueAt,
      dueAtLocal: formatInstantForZone(new Date(task.dueAt), ctx.timeZone),
      recurrence: task.recurrence,
      actions: task.actions,
      lastError: task.lastError,
      completedAt: task.completedAt,
      canceledAt: task.canceledAt,
    })),
  };
}

// Re-export for tests that may want direct device execution
export { executeDeviceAction };
