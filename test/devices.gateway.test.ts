import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db/index.js";
import { Gateway } from "../src/devices/gateway.js";
import { createRegistry } from "../src/devices/registry.js";
import { SimulatedAdapter } from "../src/devices/simulated.js";

function createGateway(): { gateway: Gateway; db: Db } {
  const dir = mkdtempSync(join(tmpdir(), "andru-gw-"));
  const db = openDb(join(dir, "test.db"));
  const adapter = new SimulatedAdapter(db);
  const gateway = new Gateway(createRegistry(adapter));
  return { gateway, db };
}

describe("DeviceGateway", () => {
  let db: Db;

  afterEach(() => {
    db?.close();
  });

  it("resolves all four bedroom devices", async () => {
    const created = createGateway();
    db = created.db;
    const all = await created.gateway.getAll();

    expect(Object.keys(all).sort()).toEqual([
      "bedroom.ac",
      "bedroom.fan",
      "bedroom.lights",
      "bedroom.rgb",
      "hall.ac",
    ]);
  });

  it("applies commands through the gateway", async () => {
    const created = createGateway();
    db = created.db;

    await created.gateway.set("bedroom.ac", { power: "on", temperature: 23 });
    expect(await created.gateway.get("bedroom.ac")).toMatchObject({
      power: "on",
      temperature: 23,
    });
  });

  it("rejects unknown device ids", async () => {
    const created = createGateway();
    db = created.db;

    await expect(
      created.gateway.get("kitchen.ac" as never),
    ).rejects.toThrow(/Unknown device/);
  });
});
