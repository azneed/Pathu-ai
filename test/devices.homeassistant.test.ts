import { describe, expect, it, vi } from "vitest";
import { HomeAssistantClient, HomeAssistantError } from "../src/devices/homeassistant/client.js";
import { DeviceMapping as HAEntityMapping } from "../src/devices/homeassistant/mapping.js";
import {
  commandToServiceCalls,
  haStateToAcState,
  haStateToDeviceState,
  haStateToFanState,
  haStateToLightsState,
  haStateToRgbState,
} from "../src/devices/homeassistant/translate.js";
import { HomeAssistantAdapter } from "../src/devices/homeassistant/adapter.js";
import { createDeviceAdapter } from "../src/devices/createDeviceAdapter.js";
import { openDb } from "../src/db/index.js";
import type { Config } from "../src/config.js";

describe("HomeAssistantClient", () => {
  it("includes Bearer token in headers and calls URL correctly", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      return new Response(
        JSON.stringify({
          entity_id: "light.bedroom_lights",
          state: "on",
          attributes: { brightness: 255 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new HomeAssistantClient({
      baseUrl: "http://192.168.1.100:8123/",
      token: "test-token-123",
      fetchImpl: mockFetch,
    });

    const state = await client.getEntityState("light.bedroom_lights");
    expect(capturedUrl).toBe("http://192.168.1.100:8123/api/states/light.bedroom_lights");
    expect(capturedHeaders.Authorization).toBe("Bearer test-token-123");
    expect(state.state).toBe("on");
  });

  it("retries GET requests on transient network or 5xx failures", async () => {
    let callCount = 0;
    const mockFetch = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response("Internal Error", { status: 500 });
      }
      return new Response(
        JSON.stringify({
          entity_id: "fan.bedroom_fan",
          state: "on",
          attributes: { percentage: 60 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new HomeAssistantClient({
      baseUrl: "http://localhost:8123",
      token: "secret",
      maxGetRetries: 2,
      fetchImpl: mockFetch,
    });

    const state = await client.getEntityState("fan.bedroom_fan");
    expect(callCount).toBe(2);
    expect(state.entity_id).toBe("fan.bedroom_fan");
  });

  it("does NOT retry POST service calls on error", async () => {
    let callCount = 0;
    const mockFetch = vi.fn(async () => {
      callCount += 1;
      return new Response("Service failure", { status: 500 });
    }) as unknown as typeof fetch;

    const client = new HomeAssistantClient({
      baseUrl: "http://localhost:8123",
      token: "secret",
      fetchImpl: mockFetch,
    });

    await expect(
      client.callService("light", "turn_on", { entity_id: "light.bedroom_lights" }),
    ).rejects.toThrow(HomeAssistantError);

    expect(callCount).toBe(1);
  });
});

describe("DeviceMapping", () => {
  it("maps canonical device IDs to HA entity IDs", () => {
    const mapping = new HAEntityMapping();
    expect(mapping.getEntityId("bedroom.ac")).toBe("climate.bedroom_ac");
    expect(mapping.getEntityId("bedroom.fan")).toBe("fan.bedroom_fan");
    expect(mapping.getEntityId("bedroom.lights")).toBe("light.bedroom_lights");
    expect(mapping.getEntityId("bedroom.rgb")).toBe("light.bedroom_rgb");
  });

  it("supports reverse mapping from HA entity ID to DeviceId", () => {
    const mapping = new HAEntityMapping();
    expect(mapping.getDeviceId("climate.bedroom_ac")).toBe("bedroom.ac");
    expect(mapping.getDeviceId("fan.bedroom_fan")).toBe("bedroom.fan");
  });
});

describe("translate (HA State <-> Pathu DeviceState)", () => {
  it("translates climate entity state to AcState", () => {
    const acState = haStateToAcState({
      entity_id: "climate.bedroom_ac",
      state: "cool",
      attributes: {
        temperature: 22,
        fan_mode: "medium",
      },
    });
    expect(acState).toEqual({
      power: "on",
      mode: "cool",
      temperature: 22,
      fanSpeed: 3,
    });
  });

  it("translates fan entity state to FanState", () => {
    const fanState = haStateToFanState({
      entity_id: "fan.bedroom_fan",
      state: "on",
      attributes: { percentage: 40 },
    });
    expect(fanState).toEqual({
      power: "on",
      speed: 2,
    });
  });

  it("translates light entity state to LightsState and RgbState", () => {
    const lightState = haStateToLightsState({
      entity_id: "light.bedroom_lights",
      state: "on",
      attributes: { brightness: 128 },
    });
    expect(lightState).toEqual({
      power: "on",
      brightness: 50,
    });

    const rgbState = haStateToRgbState({
      entity_id: "light.bedroom_rgb",
      state: "on",
      attributes: { brightness: 255, rgb_color: [255, 0, 128] },
    });
    expect(rgbState).toEqual({
      power: "on",
      brightness: 100,
      color: { r: 255, g: 0, b: 128 },
    });
  });

  it("translates commands into Home Assistant service calls", () => {
    const acCalls = commandToServiceCalls("bedroom.ac", "climate.bedroom_ac", {
      power: "on",
      temperature: 20,
      mode: "cool",
    });
    expect(acCalls).toHaveLength(3);
    expect(acCalls[0]).toEqual({
      domain: "climate",
      service: "turn_on",
      serviceData: { entity_id: "climate.bedroom_ac" },
    });

    const rgbCalls = commandToServiceCalls("bedroom.rgb", "light.bedroom_rgb", {
      power: "on",
      brightness: 80,
      color: { r: 255, g: 255, b: 0 },
    });
    expect(rgbCalls).toHaveLength(1);
    expect(rgbCalls[0]).toEqual({
      domain: "light",
      service: "turn_on",
      serviceData: {
        entity_id: "light.bedroom_rgb",
        brightness: 204,
        rgb_color: [255, 255, 0],
      },
    });
  });
});

describe("HomeAssistantAdapter", () => {
  it("fetches state and issues set service calls", async () => {
    const mockStateMap: Record<string, any> = {
      "climate.bedroom_ac": {
        entity_id: "climate.bedroom_ac",
        state: "off",
        attributes: { temperature: 24 },
      },
    };

    const mockFetch = vi.fn(async (urlStr: string | URL | Request, init?: RequestInit) => {
      const url = String(urlStr);
      if (url.includes("/api/states/climate.bedroom_ac")) {
        return new Response(JSON.stringify(mockStateMap["climate.bedroom_ac"]), { status: 200 });
      }
      if (url.includes("/api/services/climate/turn_on")) {
        mockStateMap["climate.bedroom_ac"].state = "cool";
        return new Response(JSON.stringify([mockStateMap["climate.bedroom_ac"]]), { status: 200 });
      }
      if (url.includes("/api/services/climate/set_temperature")) {
        const body = JSON.parse(String(init?.body || "{}"));
        mockStateMap["climate.bedroom_ac"].attributes.temperature = body.temperature;
        return new Response(JSON.stringify([mockStateMap["climate.bedroom_ac"]]), { status: 200 });
      }
      return new Response("OK", { status: 200 });
    }) as unknown as typeof fetch;

    const client = new HomeAssistantClient({
      baseUrl: "http://localhost:8123",
      token: "secret",
      fetchImpl: mockFetch,
    });
    const adapter = new HomeAssistantAdapter({ client });

    const initial = await adapter.get("bedroom.ac");
    expect(initial.power).toBe("off");

    const updated = await adapter.set("bedroom.ac", { power: "on", temperature: 21 });
    expect(updated.power).toBe("on");
    expect(updated.temperature).toBe(21);
  });
});

describe("createDeviceAdapter factory", () => {
  it("creates SimulatedAdapter when HOMEASSISTANT_TOKEN is empty", () => {
    const db = openDb(":memory:");
    const config = {
      HOMEASSISTANT_BASE_URL: "http://localhost:8123",
      HOMEASSISTANT_TOKEN: "",
    } as unknown as Config;

    const adapter = createDeviceAdapter({ config, db });
    expect(adapter.constructor.name).toBe("SimulatedAdapter");
    db.close();
  });

  it("creates HomeAssistantAdapter when HOMEASSISTANT_TOKEN is provided", () => {
    const db = openDb(":memory:");
    const config = {
      HOMEASSISTANT_BASE_URL: "http://localhost:8123",
      HOMEASSISTANT_TOKEN: "valid-token",
    } as unknown as Config;

    const adapter = createDeviceAdapter({ config, db });
    expect(adapter.constructor.name).toBe("HomeAssistantAdapter");
    db.close();
  });
});
