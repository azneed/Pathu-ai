import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeTool } from "../src/ai/tools.js";
import { openDb, type Db } from "../src/db/index.js";
import { Gateway } from "../src/devices/gateway.js";
import { createRegistry } from "../src/devices/registry.js";
import { SimulatedAdapter } from "../src/devices/simulated.js";
import { TaskScheduler } from "../src/tasks/scheduler.js";
import { nextOccurrence, parseDueAt } from "../src/tasks/time.js";

function createStack(options?: {
  timeZone?: string;
  now?: () => Date;
  onTasksChanged?: () => void;
}) {
  const dir = mkdtempSync(join(tmpdir(), "andru-tasks-"));
  const db = openDb(join(dir, "test.db"), {
    timeZone: options?.timeZone ?? "UTC",
    now: options?.now,
    onTasksChanged: options?.onTasksChanged,
  });
  const adapter = new SimulatedAdapter(db);
  const gateway = new Gateway(createRegistry(adapter));
  return { db, gateway, dir };
}

describe("task time helpers", () => {
  it("parses naive local dueAt in the configured timezone", async () => {
    const date = parseDueAt("2026-09-19T23:00:00", "UTC");
    expect(date.toISOString()).toBe("2026-09-19T23:00:00.000Z");
  });

  it("computes next daily occurrence after a given instant", async () => {
    const after = new Date("2026-09-19T12:00:00.000Z");
    const next = nextOccurrence(
      { frequency: "daily", hour: 18, minute: 0 },
      "UTC",
      after,
    );
    expect(next.toISOString()).toBe("2026-09-19T18:00:00.000Z");
  });
});

describe("task store and tools", () => {
  let db: Db;

  afterEach(() => {
    db?.close();
  });

  it("creates a delayed task without changing devices yet", async () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    const stack = createStack({ now: () => now });
    db = stack.db;

    const result = (await executeTool(
      "create_task",
      {
        description: "Turn AC off in 5 minutes",
        type: "delayed",
        delaySeconds: 300,
        actions: [{ tool: "set_ac", arguments: { power: "off" } }],
      },
      {
        gateway: stack.gateway,
        tasks: stack.db.tasks,
        timeZone: "UTC",
        sessionId: "default",
        now: () => now,
      },
    )) as { ok: boolean; task: { id: string; dueAt: string; status: string } };

    expect(result.ok).toBe(true);
    expect(result.task.status).toBe("pending");
    expect(result.task.dueAt).toBe("2026-09-19T12:05:00.000Z");
    expect(await stack.gateway.get("bedroom.ac")).toMatchObject({ power: "off" });
    // default is already off — ensure create didn't "turn on" or invent success
    const listed = stack.db.tasks.list({ status: "pending" });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.description).toContain("AC");
  });

  it("creates a scheduled task from dueAt", async () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    const stack = createStack({ now: () => now });
    db = stack.db;

    const result = (await executeTool(
      "create_task",
      {
        description: "Lights off at 23:00",
        type: "scheduled",
        dueAt: "2026-09-19T23:00:00Z",
        actions: [{ tool: "set_lights", arguments: { power: "off" } }],
      },
      {
        gateway: stack.gateway,
        tasks: stack.db.tasks,
        timeZone: "UTC",
        sessionId: "default",
        now: () => now,
      },
    )) as { task: { dueAt: string; type: string } };

    expect(result.task.type).toBe("scheduled");
    expect(result.task.dueAt).toBe("2026-09-19T23:00:00.000Z");
  });

  it("creates a recurring daily task and advances after execution", async () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    const stack = createStack({ timeZone: "UTC", now: () => now });
    db = stack.db;

    const created = (await executeTool(
      "create_task",
      {
        description: "AC on every day at 18:00",
        type: "recurring",
        recurrence: { frequency: "daily", hour: 18, minute: 0 },
        actions: [{ tool: "set_ac", arguments: { power: "on", temperature: 22 } }],
      },
      {
        gateway: stack.gateway,
        tasks: stack.db.tasks,
        timeZone: "UTC",
        sessionId: "default",
        now: () => now,
      },
    )) as { task: { id: string; dueAt: string } };

    expect(created.task.dueAt).toBe("2026-09-19T18:00:00.000Z");

    const executed = await stack.db.tasks.execute(created.task.id, stack.gateway);
    expect(executed.status).toBe("pending");
    expect(await stack.gateway.get("bedroom.ac")).toMatchObject({
      power: "on",
      temperature: 22,
    });
    expect(executed.dueAt).toBe("2026-09-20T18:00:00.000Z");
  });

  it("persists tasks across db reopen (restart)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "andru-tasks-persist-"));
    const path = join(dir, "test.db");
    const now = new Date("2026-09-19T12:00:00.000Z");
    const db1 = openDb(path, { timeZone: "UTC", now: () => now });
    const adapter1 = new SimulatedAdapter(db1);
    const gateway1 = new Gateway(createRegistry(adapter1));

    const created = (await executeTool(
      "create_task",
      {
        description: "Fan off in 10s",
        type: "delayed",
        delaySeconds: 10,
        actions: [{ tool: "set_fan", arguments: { power: "off" } }],
      },
      {
        gateway: gateway1,
        tasks: db1.tasks,
        timeZone: "UTC",
        sessionId: "default",
        now: () => now,
      },
    )) as { task: { id: string } };
    db1.close();

    const db2 = openDb(path, { timeZone: "UTC" });
    db = db2;
    const restored = db2.tasks.get(created.task.id);
    expect(restored?.status).toBe("pending");
    expect(restored?.description).toContain("Fan");
  });

  it("cancels a pending task so it never executes", async () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    const stack = createStack({ now: () => now });
    db = stack.db;
    await stack.gateway.set("bedroom.ac", { power: "on" });

    const created = (await executeTool(
      "create_task",
      {
        description: "Turn AC off in 60 seconds",
        type: "delayed",
        delaySeconds: 60,
        actions: [{ tool: "set_ac", arguments: { power: "off" } }],
      },
      {
        gateway: stack.gateway,
        tasks: stack.db.tasks,
        timeZone: "UTC",
        sessionId: "default",
        now: () => now,
      },
    )) as { task: { id: string } };

    const canceled = (await executeTool(
      "cancel_task",
      { query: "AC" },
      {
        gateway: stack.gateway,
        tasks: stack.db.tasks,
        timeZone: "UTC",
        sessionId: "default",
        now: () => now,
      },
    )) as { ok: boolean; canceled: { status: string } };

    expect(canceled.ok).toBe(true);
    expect(canceled.canceled.status).toBe("canceled");

    const after = await stack.db.tasks.execute(created.task.id, stack.gateway);
    expect(after.status).toBe("canceled");
    expect(await stack.gateway.get("bedroom.ac")).toMatchObject({ power: "on" });
  });

  it("looks up pending tasks via get_tasks", async () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    const stack = createStack({ now: () => now });
    db = stack.db;

    await executeTool(
      "create_task",
      {
        description: "RGB off tonight",
        type: "delayed",
        delaySeconds: 120,
        actions: [{ tool: "set_rgb", arguments: { power: "off" } }],
      },
      {
        gateway: stack.gateway,
        tasks: stack.db.tasks,
        timeZone: "UTC",
        sessionId: "default",
        now: () => now,
      },
    );

    const listed = (await executeTool(
      "get_tasks",
      {},
      {
        gateway: stack.gateway,
        tasks: stack.db.tasks,
        timeZone: "UTC",
        sessionId: "default",
        now: () => now,
      },
    )) as { tasks: Array<{ description: string }> };

    expect(listed.tasks).toHaveLength(1);
    expect(listed.tasks[0]?.description).toContain("RGB");
  });

  it("rejects invalid action arguments and does not create a task", async () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    const stack = createStack({ now: () => now });
    db = stack.db;

    await expect(
      executeTool(
        "create_task",
        {
          description: "Bad AC",
          type: "delayed",
          delaySeconds: 10,
          actions: [{ tool: "set_ac", arguments: { temperature: 5 } }],
        },
        {
          gateway: stack.gateway,
          tasks: stack.db.tasks,
          timeZone: "UTC",
          sessionId: "default",
          now: () => now,
        },
      ),
    ).rejects.toThrow();
    expect(stack.db.tasks.list({ status: "pending" })).toHaveLength(0);
  });

  it("rejects clearly past dueAt", async () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    const stack = createStack({ now: () => now });
    db = stack.db;

    await expect(
      executeTool(
        "create_task",
        {
          description: "Past",
          type: "scheduled",
          dueAt: "2026-09-19T10:00:00Z",
          actions: [{ tool: "set_ac", arguments: { power: "off" } }],
        },
        {
          gateway: stack.gateway,
          tasks: stack.db.tasks,
          timeZone: "UTC",
          sessionId: "default",
          now: () => now,
        },
      ),
    ).rejects.toThrow(/past/i);
  });

  it("executes multi-action tasks and records per-action results", async () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    const stack = createStack({ now: () => now });
    db = stack.db;
    await stack.gateway.set("bedroom.ac", { power: "on" });
    await stack.gateway.set("bedroom.lights", { power: "on", brightness: 80 });

    const created = (await executeTool(
      "create_task",
      {
        description: "AC and lights off",
        type: "delayed",
        delaySeconds: 1,
        actions: [
          { tool: "set_ac", arguments: { power: "off" } },
          { tool: "set_lights", arguments: { power: "off" } },
        ],
      },
      {
        gateway: stack.gateway,
        tasks: stack.db.tasks,
        timeZone: "UTC",
        sessionId: "default",
        now: () => now,
      },
    )) as { task: { id: string } };

    const executed = await stack.db.tasks.execute(created.task.id, stack.gateway);
    expect(executed.status).toBe("completed");
    expect(executed.result).toHaveLength(2);
    expect(executed.result?.every((r) => r.ok)).toBe(true);
    expect(await stack.gateway.get("bedroom.ac")).toMatchObject({ power: "off" });
    expect(await stack.gateway.get("bedroom.lights")).toMatchObject({ power: "off" });
  });

  it("marks task failed when an action fails and does not claim success", async () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    const stack = createStack({ now: () => now });
    db = stack.db;

    const created = stack.db.tasks.create({
      type: "delayed",
      description: "Will fail",
      dueAt: now.toISOString(),
      sessionId: "default",
      actions: [{ tool: "set_ac", arguments: { power: "off" } }],
    });

    const original = stack.gateway.set.bind(stack.gateway);
    stack.gateway.set = async () => {
      throw new Error("simulated adapter failure");
    };

    const executed = await stack.db.tasks.execute(created.id, stack.gateway);
    expect(executed.status).toBe("failed");
    expect(executed.lastError).toMatch(/simulated adapter failure/);
    expect(executed.result?.[0]?.ok).toBe(false);

    stack.gateway.set = original;
  });
});

describe("TaskScheduler", () => {
  let db: Db;
  let scheduler: TaskScheduler;

  afterEach(() => {
    scheduler?.stop();
    db?.close();
    vi.useRealTimers();
  });

  it("executes due tasks on timer without LLM", async () => {
    vi.useFakeTimers();
    const start = new Date("2026-09-19T12:00:00.000Z");
    vi.setSystemTime(start);

    const stack = createStack({ now: () => new Date() });
    db = stack.db;
    await stack.gateway.set("bedroom.ac", { power: "on" });

    stack.db.tasks.create({
      type: "delayed",
      description: "AC off soon",
      dueAt: new Date(start.getTime() + 10_000).toISOString(),
      sessionId: "default",
      actions: [{ tool: "set_ac", arguments: { power: "off" } }],
    });

    scheduler = new TaskScheduler({
      tasks: stack.db.tasks,
      gateway: stack.gateway,
      now: () => new Date(),
    });
    scheduler.start();

    expect(await stack.gateway.get("bedroom.ac")).toMatchObject({ power: "on" });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(await stack.gateway.get("bedroom.ac")).toMatchObject({ power: "off" });
    expect(stack.db.tasks.list({ status: "completed" })).toHaveLength(1);
  });

  it("recovers overdue pending tasks on start (restart)", async () => {
    const overdueAt = new Date("2026-09-19T11:59:00.000Z");
    const now = new Date("2026-09-19T12:00:00.000Z");
    const stack = createStack({ now: () => now });
    db = stack.db;
    await stack.gateway.set("bedroom.lights", { power: "on", brightness: 100 });

    stack.db.tasks.create({
      type: "scheduled",
      description: "Overdue lights off",
      dueAt: overdueAt.toISOString(),
      sessionId: "default",
      actions: [{ tool: "set_lights", arguments: { power: "off" } }],
    });

    scheduler = new TaskScheduler({
      tasks: stack.db.tasks,
      gateway: stack.gateway,
      now: () => now,
    });
    scheduler.start();
    await scheduler.tick();

    expect(await stack.gateway.get("bedroom.lights")).toMatchObject({ power: "off" });
    expect(stack.db.tasks.list({ status: "completed" })).toHaveLength(1);
  });
});
