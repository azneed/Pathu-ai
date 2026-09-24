import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeTool } from "../src/ai/tools.js";
import { openDb, type Db } from "../src/db/index.js";
import { Gateway } from "../src/devices/gateway.js";
import { createRegistry } from "../src/devices/registry.js";
import { SimulatedAdapter } from "../src/devices/simulated.js";

function createGateway(): { gateway: Gateway; db: Db } {
  const dir = mkdtempSync(join(tmpdir(), "andru-tools-"));
  const db = openDb(join(dir, "test.db"));
  const adapter = new SimulatedAdapter(db);
  const gateway = new Gateway(createRegistry(adapter));
  return { gateway, db };
}

describe("tools", () => {
  let db: Db;

  afterEach(() => {
    db?.close();
  });

  it("set_ac updates bedroom.ac via gateway", async () => {
    const created = createGateway();
    db = created.db;

    const result = await executeTool(
      "set_ac",
      { power: "on", temperature: 23 },
      created.gateway,
    );

    expect(result).toMatchObject({ power: "on", temperature: 23 });
    expect(created.gateway.get("bedroom.ac")).toMatchObject({
      power: "on",
      temperature: 23,
    });
  });

  it("get_devices returns all four states", async () => {
    const created = createGateway();
    db = created.db;

    const result = (await executeTool(
      "get_devices",
      {},
      created.gateway,
    )) as Record<string, unknown>;

    expect(Object.keys(result).sort()).toEqual([
      "bedroom.ac",
      "bedroom.fan",
      "bedroom.lights",
      "bedroom.rgb",
    ]);
  });

  it("rejects invalid set_fan args", async () => {
    const created = createGateway();
    db = created.db;

    await expect(
      executeTool("set_fan", { speed: 9 }, created.gateway),
    ).rejects.toThrow();
  });

  it("set_rgb accepts color and brightness", async () => {
    const created = createGateway();
    db = created.db;

    const result = await executeTool(
      "set_rgb",
      {
        power: "on",
        brightness: 50,
        color: { r: 255, g: 0, b: 0 },
      },
      created.gateway,
    );

    expect(result).toEqual({
      power: "on",
      brightness: 50,
      color: { r: 255, g: 0, b: 0 },
    });
  });

  it("rejects unknown tools", async () => {
    const created = createGateway();
    db = created.db;

    await expect(
      executeTool("set_device", { id: "bedroom.ac" }, created.gateway),
    ).rejects.toThrow(/Unknown tool/);
  });
});
