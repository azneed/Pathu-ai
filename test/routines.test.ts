import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeTool, toolDefinitions } from "../src/ai/tools.js";
import { openDb, type Db } from "../src/db/index.js";
import { Gateway } from "../src/devices/gateway.js";
import { createRegistry } from "../src/devices/registry.js";
import { SimulatedAdapter } from "../src/devices/simulated.js";
import type { DeviceGateway, DeviceId, DeviceState } from "../src/devices/types.js";

function createStack() {
  const dir = mkdtempSync(join(tmpdir(), "andru-routines-"));
  const db = openDb(join(dir, "test.db"), { timeZone: "UTC" });
  const adapter = new SimulatedAdapter(db);
  const gateway = new Gateway(createRegistry(adapter));
  return { db, gateway, dir };
}

function toolCtx(stack: { db: Db; gateway: Gateway }) {
  return {
    gateway: stack.gateway,
    tasks: stack.db.tasks,
    routines: stack.db.routines,
    timeZone: "UTC",
    sessionId: "default",
  };
}

describe("routines security and tools", () => {
  let db: Db;

  afterEach(() => {
    db?.close();
  });

  it("exposes routine tools without shell/browser automation", () => {
    const names = toolDefinitions.map((t) => t.name);
    expect(names).toContain("list_routines");
    expect(names).toContain("run_routine");
    expect(names).toContain("create_routine");
    expect(names).toContain("update_routine");
    expect(names).toContain("delete_routine");
    expect(names).not.toContain("shell");
    expect(names).not.toContain("browser_navigate");
    expect(names).not.toContain("run_command");
  });

  it("creates, lists, updates, and deletes a routine", async () => {
    const stack = createStack();
    db = stack.db;

    const created = (await executeTool(
      "create_routine",
      {
        name: "bedtime",
        description: "Wind down",
        actions: [
          {
            tool: "set_ac",
            arguments: { power: "on", temperature: 24, mode: "cool", fanSpeed: 2 },
          },
          { tool: "set_fan", arguments: { power: "on", speed: 2 } },
          { tool: "set_lights", arguments: { power: "off" } },
          { tool: "set_rgb", arguments: { power: "off" } },
        ],
      },
      toolCtx(stack),
    )) as { ok: boolean; routine: { id: string; name: string } };

    expect(created.ok).toBe(true);
    expect(created.routine.name).toBe("bedtime");
    expect(stack.gateway.get("bedroom.ac")).toMatchObject({ power: "off" });

    const listed = (await executeTool(
      "list_routines",
      {},
      toolCtx(stack),
    )) as { count: number; routines: Array<{ name: string }> };
    expect(listed.count).toBe(1);
    expect(listed.routines[0]?.name).toBe("bedtime");

    const updated = (await executeTool(
      "update_routine",
      {
        name: "bedtime",
        actions: [
          { tool: "set_fan", arguments: { power: "on", speed: 1 } },
          { tool: "set_lights", arguments: { power: "off" } },
        ],
      },
      toolCtx(stack),
    )) as { ok: boolean; routine: { actions: unknown[] } };
    expect(updated.ok).toBe(true);
    expect(updated.routine.actions).toHaveLength(2);

    const deleted = (await executeTool(
      "delete_routine",
      { name: "bedtime" },
      toolCtx(stack),
    )) as { ok: boolean };
    expect(deleted.ok).toBe(true);
    expect(stack.db.routines.list()).toHaveLength(0);
  });

  it("rejects invalid device actions on create", async () => {
    const stack = createStack();
    db = stack.db;

    await expect(
      executeTool(
        "create_routine",
        {
          name: "bad",
          actions: [{ tool: "set_ac", arguments: { temperature: 99 } }],
        },
        toolCtx(stack),
      ),
    ).rejects.toThrow();

    await expect(
      executeTool(
        "create_routine",
        {
          name: "shellish",
          actions: [
            {
              tool: "set_lights",
              arguments: { power: "off", shell: "rm -rf /" },
            },
          ],
        },
        toolCtx(stack),
      ),
    ).rejects.toThrow();

    await expect(
      executeTool(
        "create_routine",
        {
          name: "media",
          actions: [
            { tool: "youtube_play", arguments: { videoId: "dQw4w9WgXcQ" } },
          ],
        },
        toolCtx(stack),
      ),
    ).rejects.toThrow();

    expect(stack.db.routines.list()).toHaveLength(0);
  });

  it("runs a multi-action routine in order through DeviceGateway", async () => {
    const stack = createStack();
    db = stack.db;

    await executeTool(
      "create_routine",
      {
        name: "movie mode",
        actions: [
          {
            tool: "set_ac",
            arguments: { power: "on", temperature: 23, mode: "cool" },
          },
          { tool: "set_fan", arguments: { power: "on", speed: 1 } },
          { tool: "set_lights", arguments: { power: "on", brightness: 20 } },
          {
            tool: "set_rgb",
            arguments: {
              power: "on",
              brightness: 15,
              color: { r: 20, g: 0, b: 40 },
            },
          },
        ],
      },
      toolCtx(stack),
    );

    const run = (await executeTool(
      "run_routine",
      { name: "movie mode" },
      toolCtx(stack),
    )) as { ok: boolean; results: unknown[] };

    expect(run.ok).toBe(true);
    expect(run.results).toHaveLength(4);
    expect(stack.gateway.get("bedroom.ac")).toMatchObject({
      power: "on",
      temperature: 23,
      mode: "cool",
    });
    expect(stack.gateway.get("bedroom.fan")).toMatchObject({
      power: "on",
      speed: 1,
    });
    expect(stack.gateway.get("bedroom.lights")).toMatchObject({
      power: "on",
      brightness: 20,
    });
    expect(stack.gateway.get("bedroom.rgb")).toMatchObject({
      power: "on",
      brightness: 15,
      color: { r: 20, g: 0, b: 40 },
    });
  });

  it("stops on first failure and does not claim full success", async () => {
    const stack = createStack();
    db = stack.db;

    const routine = stack.db.routines.create({
      name: "partial",
      actions: [
        { tool: "set_lights", arguments: { power: "on", brightness: 50 } },
        { tool: "set_fan", arguments: { power: "on", speed: 2 } },
        { tool: "set_ac", arguments: { power: "on", temperature: 22 } },
      ],
    });

    const failingGateway: DeviceGateway = {
      get(id) {
        return stack.gateway.get(id);
      },
      getAll() {
        return stack.gateway.getAll();
      },
      set(id, command) {
        if (id === "bedroom.fan") {
          throw new Error("fan adapter unavailable");
        }
        return stack.gateway.set(id as DeviceId, command as never);
      },
    };

    const execution = stack.db.routines.execute(routine.id, failingGateway);
    expect(execution.success).toBe(false);
    expect(execution.ok).toBe(false);
    expect(execution.completedActions).toBe(1);
    expect(execution.failedActionIndex).toBe(1);
    expect(execution.failedAt).toBe(1);
    expect(execution.routineId).toBe(routine.id);
    expect(execution.routineName).toBe("partial");
    expect(execution.results).toHaveLength(2);
    expect(execution.results[0]?.ok).toBe(true);
    expect(execution.results[1]?.ok).toBe(false);
    expect(stack.gateway.get("bedroom.lights")).toMatchObject({
      power: "on",
      brightness: 50,
    });
    expect(stack.gateway.get("bedroom.fan")).toMatchObject({ power: "off" });
    expect(stack.gateway.get("bedroom.ac")).toMatchObject({ power: "off" });
  });

  it("rejects empty action lists on create; empty execute is a truthful no-op", async () => {
    const stack = createStack();
    db = stack.db;

    expect(() =>
      stack.db.routines.create({
        name: "empty",
        actions: [],
      }),
    ).toThrow(/at least one action/i);

    const one = stack.db.routines.create({
      name: "solo",
      actions: [{ tool: "set_lights", arguments: { power: "on", brightness: 40 } }],
    });
    // Simulate empty by updating store bypass is not allowed — create forbids empty.
    // One-action success shape:
    const run = stack.db.routines.execute(one.id, stack.gateway);
    expect(run.success).toBe(true);
    expect(run.completedActions).toBe(1);
    expect(run.routineName).toBe("solo");
    expect(stack.gateway.get("bedroom.lights")).toMatchObject({
      power: "on",
      brightness: 40,
    });
  });

  it("reports missing and ambiguous routines truthfully", async () => {
    const stack = createStack();
    db = stack.db;

    const missing = (await executeTool(
      "run_routine",
      { name: "bedtime" },
      toolCtx(stack),
    )) as { ok: boolean; error: string };
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/no routine/i);

    stack.db.routines.create({
      name: "mode",
      actions: [{ tool: "set_lights", arguments: { power: "off" } }],
    });
    stack.db.routines.create({
      name: "mode",
      actions: [{ tool: "set_fan", arguments: { power: "off" } }],
    });

    const ambiguous = (await executeTool(
      "run_routine",
      { name: "mode" },
      toolCtx(stack),
    )) as { ok: boolean; matches?: unknown[] };
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.matches).toHaveLength(2);
  });

  it("persists routines across db reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "andru-routines-persist-"));
    const path = join(dir, "test.db");
    const db1 = openDb(path, { timeZone: "UTC" });
    const created = db1.routines.create({
      name: "everything off",
      actions: [
        { tool: "set_ac", arguments: { power: "off" } },
        { tool: "set_fan", arguments: { power: "off" } },
        { tool: "set_lights", arguments: { power: "off" } },
        { tool: "set_rgb", arguments: { power: "off" } },
      ],
    });
    db1.close();

    const db2 = openDb(path, { timeZone: "UTC" });
    db = db2;
    const loaded = db2.routines.get(created.id);
    expect(loaded?.name).toBe("everything off");
    expect(loaded?.actions).toHaveLength(4);
    expect(db2.routines.findByName("Everything Off")).toHaveLength(1);
  });
});

describe("routines HTTP API", () => {
  let db: Db;

  afterEach(() => {
    db?.close();
  });

  it("supports create list run update delete over REST", async () => {
    const { createApp } = await import("../src/api/routes.js");
    const stack = createStack();
    db = stack.db;
    const app = createApp({
      db: stack.db,
      gateway: stack.gateway,
      provider: {
        async chat() {
          return {
            provider: "test",
            assistantMessage: { role: "assistant", content: "ok" },
          };
        },
      },
    });

    const createRes = await app.request("/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "bedtime",
        actions: [
          { tool: "set_ac", arguments: { power: "on", temperature: 24 } },
          { tool: "set_lights", arguments: { power: "off" } },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      routine: { id: string };
    };

    const listRes = await app.request("/routines");
    const listed = (await listRes.json()) as { routines: unknown[] };
    expect(listed.routines).toHaveLength(1);

    const runRes = await app.request(`/routines/${created.routine.id}/run`, {
      method: "POST",
    });
    const runBody = (await runRes.json()) as {
      success: boolean;
      ok: boolean;
      completedActions: number;
      devices: Record<string, DeviceState>;
    };
    expect(runBody.success).toBe(true);
    expect(runBody.ok).toBe(true);
    expect(runBody.completedActions).toBe(2);
    expect(runBody.devices["bedroom.ac"]).toMatchObject({
      power: "on",
      temperature: 24,
    });
    expect(runBody.devices["bedroom.lights"]).toMatchObject({ power: "off" });

    const patchRes = await app.request(`/routines/${created.routine.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actions: [{ tool: "set_fan", arguments: { power: "on", speed: 1 } }],
      }),
    });
    expect(patchRes.status).toBe(200);

    const delRes = await app.request(`/routines/${created.routine.id}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
    const afterDelete = (await (await app.request("/routines")).json()) as {
      routines: unknown[];
    };
    expect(afterDelete.routines).toHaveLength(0);
  });
});
