import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db/index.js";
import { SimulatedAdapter } from "../src/devices/simulated.js";

function tempDb(): Db {
  const dir = mkdtempSync(join(tmpdir(), "andru-test-"));
  return openDb(join(dir, "test.db"));
}

describe("SimulatedAdapter", () => {
  let db: Db;

  afterEach(() => {
    db?.close();
  });

  it("seeds sensible defaults", () => {
    db = tempDb();
    const adapter = new SimulatedAdapter(db);

    expect(adapter.get("bedroom.ac")).toEqual({
      power: "off",
      temperature: 24,
      mode: "cool",
      fanSpeed: 2,
    });
    expect(adapter.get("bedroom.fan")).toEqual({ power: "off", speed: 1 });
    expect(adapter.get("bedroom.lights")).toEqual({
      power: "off",
      brightness: 100,
    });
    expect(adapter.get("bedroom.rgb")).toEqual({
      power: "off",
      brightness: 100,
      color: { r: 255, g: 255, b: 255 },
    });
  });

  it("updates AC power and temperature", () => {
    db = tempDb();
    const adapter = new SimulatedAdapter(db);

    const next = adapter.set("bedroom.ac", {
      power: "on",
      temperature: 23,
    });

    expect(next).toMatchObject({ power: "on", temperature: 23, mode: "cool" });
  });

  it("rejects invalid AC temperature", () => {
    db = tempDb();
    const adapter = new SimulatedAdapter(db);

    expect(() => adapter.set("bedroom.ac", { temperature: 10 })).toThrow(
      /temperature/i,
    );
  });

  it("updates fan, lights, and rgb", () => {
    db = tempDb();
    const adapter = new SimulatedAdapter(db);

    expect(adapter.set("bedroom.fan", { power: "on", speed: 3 })).toEqual({
      power: "on",
      speed: 3,
    });
    expect(adapter.set("bedroom.lights", { power: "on", brightness: 80 })).toEqual(
      {
        power: "on",
        brightness: 80,
      },
    );
    expect(
      adapter.set("bedroom.rgb", {
        power: "on",
        brightness: 50,
        color: { r: 255, g: 0, b: 0 },
      }),
    ).toEqual({
      power: "on",
      brightness: 50,
      color: { r: 255, g: 0, b: 0 },
    });
  });

  it("persists device state across adapter instances", () => {
    db = tempDb();
    const first = new SimulatedAdapter(db);
    first.set("bedroom.ac", { power: "on", temperature: 23 });

    const second = new SimulatedAdapter(db);
    expect(second.get("bedroom.ac")).toMatchObject({
      power: "on",
      temperature: 23,
    });
  });
});
