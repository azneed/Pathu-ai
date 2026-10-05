import { afterEach, describe, expect, it } from "vitest";
import { findLegacyHomeAssistantVars, loadConfig } from "../src/config.js";
import { createDeviceAdapter } from "../src/devices/createDeviceAdapter.js";
import { HomeAssistantAdapter } from "../src/devices/homeassistant/adapter.js";
import { SimulatedAdapter } from "../src/devices/simulated.js";
import { openDb, type Db } from "../src/db/index.js";

const TOKEN = "config-test-token-must-never-appear-0123456789";

function configError(env: NodeJS.ProcessEnv): string {
  try {
    loadConfig(env);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected loadConfig to throw");
}

describe("device backend configuration", () => {
  let db: Db | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("defaults to the simulated backend without any Home Assistant settings", () => {
    const config = loadConfig({});
    expect(config.DEVICE_BACKEND).toBe("simulated");
    expect(config.HOME_ASSISTANT_URL).toBeUndefined();
    expect(config.HOME_ASSISTANT_TOKEN).toBeUndefined();
    expect(config.HOME_ASSISTANT_TIMEOUT_MS).toBe(5000);

    db = openDb(":memory:");
    expect(createDeviceAdapter({ config, db })).toBeInstanceOf(SimulatedAdapter);
  });

  it("stays simulated even when Home Assistant settings are present", () => {
    const config = loadConfig({ HOME_ASSISTANT_URL: "http://ha.local:8123", HOME_ASSISTANT_TOKEN: TOKEN });
    db = openDb(":memory:");
    expect(createDeviceAdapter({ config, db })).toBeInstanceOf(SimulatedAdapter);
  });

  it("builds the Home Assistant adapter when selected and configured", () => {
    const config = loadConfig({
      DEVICE_BACKEND: "homeassistant",
      HOME_ASSISTANT_URL: " https://ha.example.com:8443/ ",
      HOME_ASSISTANT_TOKEN: ` ${TOKEN} `,
      HOME_ASSISTANT_TIMEOUT_MS: "2500",
    });
    expect(config.HOME_ASSISTANT_URL).toBe("https://ha.example.com:8443");
    expect(config.HOME_ASSISTANT_TOKEN).toBe(TOKEN);
    expect(config.HOME_ASSISTANT_TIMEOUT_MS).toBe(2500);

    db = openDb(":memory:");
    expect(createDeviceAdapter({ config, db })).toBeInstanceOf(HomeAssistantAdapter);
  });

  it("fails fast when homeassistant mode lacks the URL or token, without printing secrets", () => {
    const missingBoth = configError({ DEVICE_BACKEND: "homeassistant" });
    expect(missingBoth).toContain("HOME_ASSISTANT_URL: is required when DEVICE_BACKEND=homeassistant");
    expect(missingBoth).toContain("HOME_ASSISTANT_TOKEN: is required when DEVICE_BACKEND=homeassistant");

    const missingUrl = configError({ DEVICE_BACKEND: "homeassistant", HOME_ASSISTANT_TOKEN: TOKEN });
    expect(missingUrl).toContain("HOME_ASSISTANT_URL");
    expect(missingUrl).not.toContain(TOKEN);

    const blankToken = configError({
      DEVICE_BACKEND: "homeassistant",
      HOME_ASSISTANT_URL: "http://ha.local:8123",
      HOME_ASSISTANT_TOKEN: "   ",
    });
    expect(blankToken).toContain("HOME_ASSISTANT_TOKEN");
  });

  it("never falls back to simulated when the adapter is built from an incomplete config", () => {
    const memoryDb = openDb(":memory:");
    db = memoryDb;
    expect(() =>
      createDeviceAdapter({
        config: {
          DEVICE_BACKEND: "homeassistant",
          HOME_ASSISTANT_URL: "http://ha.local:8123",
          HOME_ASSISTANT_TOKEN: undefined,
          HOME_ASSISTANT_TIMEOUT_MS: 5000,
        },
        db: memoryDb,
      }),
    ).toThrow(/requires HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN/);
  });

  it.each([
    "ha.local:8123",
    "ftp://ha.local",
    `http://user:${TOKEN}@ha.local:8123`,
    "http://ha.local:8123/?token=x",
  ])("rejects HOME_ASSISTANT_URL %s without echoing it", (url) => {
    const message = configError({ HOME_ASSISTANT_URL: url });
    expect(message).toContain("HOME_ASSISTANT_URL: must be an http(s) URL");
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain("ha.local");
  });

  it.each(["0", "-5", "abc", "1.5", "60001"])("rejects HOME_ASSISTANT_TIMEOUT_MS=%s", (value) => {
    expect(configError({ HOME_ASSISTANT_TIMEOUT_MS: value })).toContain("HOME_ASSISTANT_TIMEOUT_MS");
  });

  it("rejects unknown backends", () => {
    expect(configError({ DEVICE_BACKEND: "zigbee" })).toContain("DEVICE_BACKEND");
  });

  it("detects the ignored pre-release HOMEASSISTANT_* variables by name only", () => {
    expect(findLegacyHomeAssistantVars({ HOMEASSISTANT_TOKEN: TOKEN, HOMEASSISTANT_BASE_URL: "" })).toEqual([
      "HOMEASSISTANT_TOKEN",
    ]);
    expect(loadConfig({ HOMEASSISTANT_TOKEN: TOKEN }).DEVICE_BACKEND).toBe("simulated");
  });
});
