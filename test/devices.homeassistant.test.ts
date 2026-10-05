import { afterEach, describe, expect, it } from "vitest";
import {
  HomeAssistantClient,
  HomeAssistantError,
  type HaEntityState,
} from "../src/devices/homeassistant/client.js";
import { DeviceMapping } from "../src/devices/homeassistant/mapping.js";
import {
  commandToServiceCalls,
  fanSpeedLadder,
  haStateToAcState,
  haStateToDeviceState,
  haStateToFanState,
  haStateToLightsState,
  haStateToRgbState,
  speedToFanMode,
} from "../src/devices/homeassistant/translate.js";
import { HomeAssistantAdapter } from "../src/devices/homeassistant/adapter.js";
import { DeviceCommandError, DeviceUnavailableError } from "../src/devices/errors.js";
import { Gateway } from "../src/devices/gateway.js";
import { createRegistry } from "../src/devices/registry.js";
import { DEVICE_IDS, type DeviceId } from "../src/devices/types.js";
import {
  startFakeHomeAssistant,
  unusedLocalUrl,
  type FakeHomeAssistant,
} from "./helpers/fakeHomeAssistant.js";

const ENTITY_IDS = [
  "climate.bedroom_ac",
  "fan.bedroom_fan",
  "light.bedroom_lights",
  "light.bedroom_rgb",
];

/** A message that may reach the LLM must not reveal HA internals. */
function expectSafeMessage(message: string, extraForbidden: string[] = []) {
  for (const forbidden of [...ENTITY_IDS, "fake-ha-token", "127.0.0.1", "Bearer", ...extraForbidden]) {
    expect(message).not.toContain(forbidden);
  }
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`non-Error rejection: ${String(error)}`);
  }
  throw new Error("expected the promise to reject");
}

function entity(
  entity_id: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HaEntityState {
  return { entity_id, state, attributes };
}

let ha: FakeHomeAssistant | undefined;

afterEach(async () => {
  await ha?.close();
  ha = undefined;
});

function clientFor(server: FakeHomeAssistant, overrides: Partial<ConstructorParameters<typeof HomeAssistantClient>[0]> = {}) {
  return new HomeAssistantClient({
    baseUrl: server.url,
    token: server.token,
    retryDelayMs: 1,
    ...overrides,
  });
}

describe("HomeAssistantClient over HTTP", () => {
  it("sends the bearer token to the normalized base URL", async () => {
    ha = await startFakeHomeAssistant();
    const client = clientFor(ha, { baseUrl: `${ha.url}//` });

    const state = await client.getEntityState("light.bedroom_lights");

    expect(state.state).toBe("off");
    expect(ha.requests).toHaveLength(1);
    expect(ha.requests[0]).toMatchObject({
      method: "GET",
      path: "/api/states/light.bedroom_lights",
      authorization: `Bearer ${ha.token}`,
    });
  });

  it("does not retry 4xx and reports a safe auth error", async () => {
    ha = await startFakeHomeAssistant();
    const client = clientFor(ha, { token: "wrong-token", maxGetRetries: 3 });

    const error = await captureError(client.getEntityState("climate.bedroom_ac"));

    expect(error).toBeInstanceOf(HomeAssistantError);
    expect((error as HomeAssistantError).kind).toBe("http");
    expect((error as HomeAssistantError).statusCode).toBe(401);
    expect(ha.requests).toHaveLength(1);
    expect(error.message).toBe("Home Assistant rejected the access token (HTTP 401)");
    expectSafeMessage(error.message, ["wrong-token", "Unauthorized"]);
  });

  it("retries a transient 5xx GET once, then succeeds", async () => {
    ha = await startFakeHomeAssistant();
    ha.addFault("/api/states/fan.bedroom_fan", { type: "status", status: 503 }, 1);

    const state = await clientFor(ha).getEntityState("fan.bedroom_fan");

    expect(state.entity_id).toBe("fan.bedroom_fan");
    expect(ha.requests).toHaveLength(2);
  });

  it("keeps response bodies out of the message but in diagnostics", async () => {
    ha = await startFakeHomeAssistant();
    ha.addFault("/api/states", { type: "status", status: 500, body: "Traceback: internal detail" });

    const error = (await captureError(clientFor(ha).getEntityState("climate.bedroom_ac"))) as HomeAssistantError;

    expect(ha.requests).toHaveLength(2);
    expect(error.message).toBe("Home Assistant request failed (HTTP 500)");
    expectSafeMessage(error.message, ["Traceback"]);
    expect(error.diagnostics.responseSnippet).toContain("Traceback");
    expect(error.diagnostics.path).toBe("/api/states/climate.bedroom_ac");
    expect(JSON.stringify(error)).not.toContain("Traceback");
    expect(JSON.stringify(error)).not.toContain("climate.bedroom_ac");
  });

  it("times out before response headers", async () => {
    ha = await startFakeHomeAssistant();
    ha.addFault("/api/states", { type: "delay", ms: 1500 });
    const started = Date.now();

    const error = (await captureError(
      clientFor(ha, { timeoutMs: 100, maxGetRetries: 0 }).getEntityState("climate.bedroom_ac"),
    )) as HomeAssistantError;

    expect(error.kind).toBe("timeout");
    expect(error.message).toBe("Home Assistant did not respond in time");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("times out while the response body is still streaming", async () => {
    ha = await startFakeHomeAssistant();
    ha.addFault("/api/states", { type: "stall_body" });
    const started = Date.now();

    const error = (await captureError(
      clientFor(ha, { timeoutMs: 150, maxGetRetries: 0 }).getEntityStates(ENTITY_IDS),
    )) as HomeAssistantError;

    expect(error.kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("wraps network failures in a typed, safe error and retries GET once", async () => {
    const url = await unusedLocalUrl();
    let calls = 0;
    const countingFetch: typeof fetch = (input, init) => {
      calls += 1;
      return fetch(input, init);
    };
    const client = new HomeAssistantClient({
      baseUrl: url,
      token: "fake-ha-token-x",
      retryDelayMs: 1,
      fetchImpl: countingFetch,
    });

    const error = (await captureError(client.getEntityState("light.bedroom_rgb"))) as HomeAssistantError;

    expect(error).toBeInstanceOf(HomeAssistantError);
    expect(error.kind).toBe("network");
    expect(error.message).toBe("Home Assistant is unreachable");
    expect(calls).toBe(2);
    expectSafeMessage(error.message, [url]);
  });

  it("does not retry invalid JSON", async () => {
    ha = await startFakeHomeAssistant();
    ha.addFault("/api/states", { type: "raw", body: "<html>proxy login</html>" });

    const error = (await captureError(clientFor(ha).getEntityState("climate.bedroom_ac"))) as HomeAssistantError;

    expect(error.kind).toBe("invalid_json");
    expect(ha.requests).toHaveLength(1);
    expectSafeMessage(error.message, ["proxy login"]);
  });

  it("does not retry schema validation failures", async () => {
    ha = await startFakeHomeAssistant();
    ha.addFault("/api/states", { type: "raw", body: JSON.stringify({ unexpected: true }) });

    const error = (await captureError(clientFor(ha).getEntityState("climate.bedroom_ac"))) as HomeAssistantError;

    expect(error.kind).toBe("invalid_response");
    expect(ha.requests).toHaveLength(1);
  });

  it("never retries POST service calls, on HTTP errors or timeouts", async () => {
    ha = await startFakeHomeAssistant();
    ha.addFault("/api/services/light/turn_on", { type: "status", status: 500 }, 1);
    ha.addFault("/api/services/light/turn_off", { type: "delay", ms: 1500 }, 1);
    const client = clientFor(ha, { timeoutMs: 100, maxGetRetries: 5 });

    const httpError = (await captureError(
      client.callService("light", "turn_on", { entity_id: "light.bedroom_lights" }),
    )) as HomeAssistantError;
    const timeoutError = (await captureError(
      client.callService("light", "turn_off", { entity_id: "light.bedroom_lights" }),
    )) as HomeAssistantError;

    expect(httpError.kind).toBe("http");
    expect(timeoutError.kind).toBe("timeout");
    expect(ha.requests.map((r) => r.path)).toEqual([
      "/api/services/light/turn_on",
      "/api/services/light/turn_off",
    ]);
  });

  it("rejects malformed service names without sending anything", async () => {
    ha = await startFakeHomeAssistant();

    const error = await captureError(
      clientFor(ha).callService("light/../../api/config", "turn_on", { entity_id: "x" }),
    );

    expect(error).toBeInstanceOf(HomeAssistantError);
    expect(ha.requests).toHaveLength(0);
  });
});

describe("DeviceMapping", () => {
  it("maps canonical device IDs to HA entity IDs and back", () => {
    const mapping = new DeviceMapping();
    expect(DEVICE_IDS.map((id) => mapping.getEntityId(id))).toEqual(ENTITY_IDS);
    expect(mapping.getDeviceId("fan.bedroom_fan")).toBe("bedroom.fan");
  });

  it("rejects entities in the wrong domain, malformed IDs and duplicates", () => {
    expect(() => new DeviceMapping({ "bedroom.ac": "light.bedroom_ac" })).toThrow(/"climate" domain/);
    expect(() => new DeviceMapping({ "bedroom.fan": "fan.Bedroom Fan" })).toThrow(/Invalid/);
    expect(() => new DeviceMapping({ "bedroom.rgb": "light.bedroom_lights" })).toThrow(/already mapped/);
  });

  it("only allows the device's own domain and allowlisted services", () => {
    const mapping = new DeviceMapping();
    expect(mapping.isAllowedCall("bedroom.lights", "light", "turn_on")).toBe(true);
    expect(mapping.isAllowedCall("bedroom.lights", "light", "toggle")).toBe(false);
    expect(mapping.isAllowedCall("bedroom.lights", "climate", "turn_on")).toBe(false);
    expect(mapping.isAllowedCall("bedroom.ac", "homeassistant", "restart")).toBe(false);
  });
});

describe("translate: HA state -> Pathu state", () => {
  it.each(DEVICE_IDS.map((id, i) => [id, ENTITY_IDS[i]!] as const))(
    "reports %s as unavailable for unavailable/unknown, never as on or off",
    (deviceId, entityId) => {
      for (const raw of ["unavailable", "unknown"]) {
        expect(() => haStateToDeviceState(deviceId, entity(entityId, raw))).toThrow(DeviceUnavailableError);
      }
    },
  );

  it("uses the target temperature, never current_temperature", () => {
    expect(haStateToAcState(entity("climate.a", "cool", { temperature: 21, current_temperature: 28 })).temperature).toBe(21);
    expect(haStateToAcState(entity("climate.a", "off", { current_temperature: 28 })).temperature).toBe(24);
    expect(
      haStateToAcState(entity("climate.a", "heat_cool", { target_temp_low: 20, target_temp_high: 24 })),
    ).toMatchObject({ temperature: 22, mode: "auto", power: "on" });
  });

  it("derives AC fanSpeed from the entity's own fan_modes", () => {
    const fan_modes = ["auto", "low", "medium", "high"];
    expect(haStateToAcState(entity("climate.a", "cool", { fan_modes, fan_mode: "low" })).fanSpeed).toBe(1);
    expect(haStateToAcState(entity("climate.a", "cool", { fan_modes, fan_mode: "medium" })).fanSpeed).toBe(3);
    expect(haStateToAcState(entity("climate.a", "cool", { fan_modes, fan_mode: "high" })).fanSpeed).toBe(5);
    // auto is not a speed step: fall back to the default
    expect(haStateToAcState(entity("climate.a", "cool", { fan_modes, fan_mode: "auto" })).fanSpeed).toBe(2);
  });

  it("handles off-state attributes that HA reports as null", () => {
    expect(haStateToLightsState(entity("light.a", "off", { brightness: null }))).toEqual({ power: "off", brightness: 0 });
    expect(haStateToRgbState(entity("light.b", "off", { brightness: null, rgb_color: null }))).toEqual({
      power: "off",
      brightness: 0,
      color: { r: 255, g: 255, b: 255 },
    });
    expect(haStateToFanState(entity("fan.a", "off", { percentage: 0 }))).toEqual({ power: "off", speed: 1 });
    expect(haStateToAcState(entity("climate.a", "off", { temperature: 23 }))).toMatchObject({ power: "off", temperature: 23 });
  });
});

describe("translate: AC commands", () => {
  const AC = "climate.bedroom_ac";
  const base = {
    hvac_modes: ["off", "cool", "heat", "fan_only", "dry"],
    fan_modes: ["auto", "low", "medium", "high"],
    supported_features: 1 | 8 | 128,
  };

  it("maps fan speeds onto the entity's fan_modes and never invents modes", () => {
    const off = entity(AC, "cool", base);
    const modes = [1, 2, 3, 4, 5].map(
      (fanSpeed) => commandToServiceCalls("bedroom.ac", AC, { fanSpeed }, off)[0]!.serviceData.fan_mode,
    );
    expect(modes).toEqual(["low", "medium", "medium", "high", "high"]);
    for (const mode of modes) expect(base.fan_modes).toContain(mode);

    expect(speedToFanMode(2, ["1", "2", "3", "4", "5"])).toBe("2");
    expect(speedToFanMode(5, ["Low", "Mid", "High", "Turbo", "Quiet"])).toBe("High");
    expect(fanSpeedLadder(["auto", "quiet", "medium-low", "low", "high"])).toEqual(["low", "medium-low", "high"]);
  });

  it("rejects fan speed when the AC exposes no speed fan_modes", () => {
    const noSpeeds = entity(AC, "cool", { ...base, fan_modes: ["auto"] });
    expect(() => commandToServiceCalls("bedroom.ac", AC, { fanSpeed: 3 }, noSpeeds)).toThrow(DeviceCommandError);
    const noFanFeature = entity(AC, "cool", { ...base, supported_features: 1 });
    expect(() => commandToServiceCalls("bedroom.ac", AC, { fanSpeed: 3 }, noFanFeature)).toThrow(/fan speed/);
  });

  it("powers on with set_hvac_mode when turn_on is not supported", () => {
    expect(commandToServiceCalls("bedroom.ac", AC, { power: "on" }, entity(AC, "off", base))).toEqual([
      { domain: "climate", service: "set_hvac_mode", serviceData: { entity_id: AC, hvac_mode: "cool" } },
    ]);
    const heatOnly = entity(AC, "off", { ...base, hvac_modes: ["off", "heat"] });
    expect(commandToServiceCalls("bedroom.ac", AC, { power: "on" }, heatOnly)[0]!.serviceData.hvac_mode).toBe("heat");
    // already running: keep its current mode instead of switching to cool
    const heating = entity(AC, "heat", base);
    expect(commandToServiceCalls("bedroom.ac", AC, { power: "on" }, heating)[0]!.serviceData.hvac_mode).toBe("heat");
  });

  it("uses climate.turn_on only when the entity advertises TURN_ON", () => {
    const withTurnOn = entity(AC, "off", { ...base, supported_features: base.supported_features | 256 });
    expect(commandToServiceCalls("bedroom.ac", AC, { power: "on" }, withTurnOn)).toEqual([
      { domain: "climate", service: "turn_on", serviceData: { entity_id: AC } },
    ]);
  });

  it("a requested mode is the power-on call, mapped to HA hvac modes", () => {
    const calls = commandToServiceCalls("bedroom.ac", AC, { power: "on", mode: "fan", temperature: 22 }, entity(AC, "off", base));
    expect(calls.map((c) => c.service)).toEqual(["set_hvac_mode", "set_temperature"]);
    expect(calls[0]!.serviceData.hvac_mode).toBe("fan_only");

    const heatCool = entity(AC, "off", { ...base, hvac_modes: ["off", "heat_cool"] });
    expect(commandToServiceCalls("bedroom.ac", AC, { mode: "auto" }, heatCool)[0]!.serviceData.hvac_mode).toBe("heat_cool");
    expect(() => commandToServiceCalls("bedroom.ac", AC, { mode: "auto" }, entity(AC, "off", base))).toThrow(/not supported/);
  });

  it("turns off with turn_off when supported, else set_hvac_mode off", () => {
    expect(commandToServiceCalls("bedroom.ac", AC, { power: "off" }, entity(AC, "cool", base))[0]!.service).toBe("turn_off");
    const noTurnOff = entity(AC, "cool", { ...base, supported_features: 1 });
    expect(commandToServiceCalls("bedroom.ac", AC, { power: "off" }, noTurnOff)[0]).toEqual({
      domain: "climate",
      service: "set_hvac_mode",
      serviceData: { entity_id: AC, hvac_mode: "off" },
    });
  });

  it("rejects power=off combined with other fields instead of dropping them", () => {
    expect(() =>
      commandToServiceCalls("bedroom.ac", AC, { power: "off", temperature: 20 }, entity(AC, "cool", base)),
    ).toThrow(/cannot be combined with temperature/);
  });

  it("rejects temperature when the entity has no target temperature", () => {
    const noTarget = entity(AC, "cool", { ...base, supported_features: 8 });
    expect(() => commandToServiceCalls("bedroom.ac", AC, { temperature: 22 }, noTarget)).toThrow(/temperature/);
  });
});

describe("translate: fan and light commands", () => {
  it("checks SET_SPEED before sending a fan percentage", () => {
    const noSpeed = entity("fan.f", "off", { supported_features: 16 | 32 });
    expect(() => commandToServiceCalls("bedroom.fan", "fan.f", { speed: 3 }, noSpeed)).toThrow(/speed control/);
    expect(commandToServiceCalls("bedroom.fan", "fan.f", { power: "on" }, noSpeed)).toEqual([
      { domain: "fan", service: "turn_on", serviceData: { entity_id: "fan.f" } },
    ]);
    const withSpeed = entity("fan.f", "off", { supported_features: 1 });
    expect(commandToServiceCalls("bedroom.fan", "fan.f", { speed: 3 }, withSpeed)[0]!.serviceData.percentage).toBe(60);
  });

  it("rejects fan power=off combined with a speed", () => {
    expect(() =>
      commandToServiceCalls("bedroom.fan", "fan.f", { power: "off", speed: 2 }, entity("fan.f", "on", { supported_features: 1 })),
    ).toThrow(DeviceCommandError);
  });

  it("handles light off-state combinations", () => {
    const dimmable = entity("light.l", "on", { supported_color_modes: ["brightness"] });
    const off = [{ domain: "light", service: "turn_off", serviceData: { entity_id: "light.l" } }];
    expect(commandToServiceCalls("bedroom.lights", "light.l", { power: "off", brightness: 0 }, dimmable)).toEqual(off);
    expect(commandToServiceCalls("bedroom.lights", "light.l", { brightness: 0 }, dimmable)).toEqual(off);
    expect(() =>
      commandToServiceCalls("bedroom.lights", "light.l", { power: "off", brightness: 40 }, dimmable),
    ).toThrow(/cannot be combined with brightness/);
  });

  it("checks brightness and color support", () => {
    const onOff = entity("light.l", "off", { supported_color_modes: ["onoff"] });
    expect(() => commandToServiceCalls("bedroom.lights", "light.l", { brightness: 50 }, onOff)).toThrow(/brightness/);
    const whiteOnly = entity("light.r", "off", { supported_color_modes: ["color_temp"] });
    expect(() =>
      commandToServiceCalls("bedroom.rgb", "light.r", { color: { r: 255, g: 0, b: 0 } }, whiteOnly),
    ).toThrow(/color/);
    const rgb = entity("light.r", "off", { supported_color_modes: ["rgb"] });
    expect(commandToServiceCalls("bedroom.rgb", "light.r", { power: "on", brightness: 80, color: { r: 255, g: 255, b: 0 } }, rgb)).toEqual([
      {
        domain: "light",
        service: "turn_on",
        serviceData: { entity_id: "light.r", brightness: 204, rgb_color: [255, 255, 0] },
      },
    ]);
  });
});

describe("HomeAssistantAdapter against a fake Home Assistant", () => {
  function adapterFor(server: FakeHomeAssistant, now?: () => number) {
    return new HomeAssistantAdapter({ client: clientFor(server), now });
  }

  it("reads all devices with one bulk request and reuses it within the cache TTL", async () => {
    ha = await startFakeHomeAssistant();
    let clock = 1_000;
    const adapter = adapterFor(ha, () => clock);

    const [first, second] = await Promise.all([adapter.getMany(DEVICE_IDS), adapter.getMany(DEVICE_IDS)]);
    expect(first).toEqual(second);
    expect(first["bedroom.ac"]).toMatchObject({ power: "off", temperature: 24 });
    expect(ha.requests.map((r) => r.path)).toEqual(["/api/states"]);

    clock += 1_000;
    await adapter.getMany(DEVICE_IDS);
    expect(ha.requests).toHaveLength(1);

    clock += 5_000;
    await adapter.getMany(DEVICE_IDS);
    expect(ha.requests).toHaveLength(2);
  });

  it("marks only the affected devices unavailable", async () => {
    ha = await startFakeHomeAssistant();
    ha.entities.get("fan.bedroom_fan")!.state = "unavailable";
    ha.entities.delete("light.bedroom_rgb");

    const states = await adapterFor(ha).getMany(DEVICE_IDS);

    expect(states["bedroom.fan"]).toEqual({ status: "unavailable" });
    expect(states["bedroom.rgb"]).toEqual({ status: "unavailable" });
    expect(states["bedroom.lights"]).toEqual({ power: "off", brightness: 0 });
  });

  it("applies an AC command with capability-aware calls and returns the fresh state", async () => {
    ha = await startFakeHomeAssistant();
    const adapter = adapterFor(ha);

    const result = await adapter.set("bedroom.ac", { power: "on", temperature: 21, fanSpeed: 5 });

    expect(result).toEqual({ power: "on", mode: "cool", temperature: 21, fanSpeed: 5 });
    expect(ha.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /api/states/climate.bedroom_ac",
      "POST /api/services/climate/set_hvac_mode",
      "POST /api/services/climate/set_temperature",
      "POST /api/services/climate/set_fan_mode",
      "GET /api/states/climate.bedroom_ac",
    ]);
  });

  it("reports a partial multi-call failure safely and does not continue", async () => {
    ha = await startFakeHomeAssistant();
    ha.addFault("/api/services/climate/set_temperature", {
      type: "status",
      status: 500,
      body: "Error in climate.bedroom_ac integration",
    });
    const adapter = adapterFor(ha);

    const error = await captureError(adapter.set("bedroom.ac", { power: "on", temperature: 21, fanSpeed: 5 }));

    expect(error).toBeInstanceOf(DeviceCommandError);
    expect(error.message).toBe(
      "bedroom.ac: Home Assistant request failed (HTTP 500) (step 2 of 3 failed; 1 earlier step was applied)",
    );
    expectSafeMessage(error.message, ["integration"]);
    expect(ha.requests.some((r) => r.path.endsWith("/set_fan_mode"))).toBe(false);

    // the applied power-on is visible: the cache was invalidated, so this re-reads HA
    const before = ha.requests.length;
    expect(await adapter.get("bedroom.ac")).toMatchObject({ power: "on" });
    expect(ha.requests.length).toBe(before + 1);
  });

  it("sends nothing for unsupported commands or unavailable devices", async () => {
    ha = await startFakeHomeAssistant();
    ha.entities.get("fan.bedroom_fan")!.attributes.supported_features = 16 | 32;
    ha.entities.get("light.bedroom_lights")!.state = "unknown";
    const adapter = adapterFor(ha);

    await expect(adapter.set("bedroom.fan", { speed: 4 })).rejects.toThrow(DeviceCommandError);
    await expect(adapter.set("bedroom.lights", { power: "on" })).rejects.toThrow(DeviceUnavailableError);
    expect(ha.requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("surfaces an unreachable Home Assistant as a safe device error", async () => {
    const url = await unusedLocalUrl();
    const adapter = new HomeAssistantAdapter({
      client: new HomeAssistantClient({ baseUrl: url, token: "fake-ha-token-y", retryDelayMs: 1 }),
    });

    const error = await captureError(adapter.set("bedroom.lights", { power: "on" }));

    expect(error.message).toBe("bedroom.lights: Home Assistant is unreachable");
    expectSafeMessage(error.message, [url]);
  });
});

describe("Gateway with Home Assistant down", () => {
  it("returns unavailable entries instead of throwing and logs only safe text", async () => {
    const url = await unusedLocalUrl();
    const adapter = new HomeAssistantAdapter({
      client: new HomeAssistantClient({ baseUrl: url, token: "fake-ha-token-z", retryDelayMs: 1 }),
    });
    const logged: Array<{ ids: readonly DeviceId[]; message: string }> = [];
    const gateway = new Gateway(createRegistry(adapter), {
      onReadError: (ids, error) => logged.push({ ids, message: (error as Error).message }),
    });

    const snapshot = await gateway.getAll();

    for (const id of DEVICE_IDS) expect(snapshot[id]).toEqual({ status: "unavailable" });
    expect(logged).toEqual([{ ids: [...DEVICE_IDS], message: "Home Assistant is unreachable" }]);
  });
});
