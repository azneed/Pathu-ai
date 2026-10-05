import type {
  AcCommand,
  AcMode,
  AcState,
  DeviceCommand,
  DeviceId,
  DeviceState,
  FanCommand,
  FanState,
  LightsCommand,
  LightsState,
  RgbCommand,
  RgbState,
} from "../types.js";
import type { HaEntityState } from "./client.js";

export interface ServiceCallSpec {
  domain: string;
  service: string;
  serviceData: Record<string, unknown>;
}

export function haStateToAcState(haState: HaEntityState): AcState {
  const isOff = haState.state === "off";
  const power = isOff ? "off" : "on";

  let mode: AcMode = "cool";
  const rawMode = haState.state === "fan_only" ? "fan" : haState.state;
  if (["cool", "heat", "fan", "auto", "dry"].includes(rawMode)) {
    mode = rawMode as AcMode;
  } else if (typeof haState.attributes.hvac_mode === "string") {
    const attrMode = haState.attributes.hvac_mode === "fan_only" ? "fan" : haState.attributes.hvac_mode;
    if (["cool", "heat", "fan", "auto", "dry"].includes(attrMode)) {
      mode = attrMode as AcMode;
    }
  }

  const tempAttr = haState.attributes.temperature ?? haState.attributes.current_temperature;
  const temperature = typeof tempAttr === "number" ? Math.round(tempAttr) : 24;

  let fanSpeed = 2;
  const fanModeAttr = haState.attributes.fan_mode;
  if (typeof fanModeAttr === "number") {
    fanSpeed = Math.max(1, Math.min(5, Math.round(fanModeAttr)));
  } else if (typeof fanModeAttr === "string") {
    const parsed = parseInt(fanModeAttr, 10);
    if (!Number.isNaN(parsed)) {
      fanSpeed = Math.max(1, Math.min(5, parsed));
    } else if (fanModeAttr.includes("low")) fanSpeed = 1;
    else if (fanModeAttr.includes("medium")) fanSpeed = 3;
    else if (fanModeAttr.includes("high")) fanSpeed = 5;
  }

  return { power, temperature, mode, fanSpeed };
}

export function haStateToFanState(haState: HaEntityState): FanState {
  const power = haState.state === "on" ? "on" : "off";
  let speed = 1;
  const pct = haState.attributes.percentage;
  if (typeof pct === "number" && pct > 0) {
    speed = Math.max(1, Math.min(5, Math.ceil(pct / 20)));
  }
  return { power, speed };
}

export function haStateToLightsState(haState: HaEntityState): LightsState {
  const power = haState.state === "on" ? "on" : "off";
  let brightness = 100;
  const rawBright = haState.attributes.brightness;
  if (typeof rawBright === "number") {
    brightness = Math.max(0, Math.min(100, Math.round((rawBright / 255) * 100)));
  } else if (power === "off") {
    brightness = 0;
  }
  return { power, brightness };
}

export function haStateToRgbState(haState: HaEntityState): RgbState {
  const power = haState.state === "on" ? "on" : "off";
  let brightness = 100;
  const rawBright = haState.attributes.brightness;
  if (typeof rawBright === "number") {
    brightness = Math.max(0, Math.min(100, Math.round((rawBright / 255) * 100)));
  } else if (power === "off") {
    brightness = 0;
  }

  let color = { r: 255, g: 255, b: 255 };
  const rawRgb = haState.attributes.rgb_color;
  if (Array.isArray(rawRgb) && rawRgb.length >= 3) {
    color = {
      r: Math.max(0, Math.min(255, Math.round(Number(rawRgb[0]) || 0))),
      g: Math.max(0, Math.min(255, Math.round(Number(rawRgb[1]) || 0))),
      b: Math.max(0, Math.min(255, Math.round(Number(rawRgb[2]) || 0))),
    };
  }

  return { power, brightness, color };
}

export function haStateToDeviceState(deviceId: DeviceId, haState: HaEntityState): DeviceState {
  switch (deviceId) {
    case "bedroom.ac":
      return haStateToAcState(haState);
    case "bedroom.fan":
      return haStateToFanState(haState);
    case "bedroom.lights":
      return haStateToLightsState(haState);
    case "bedroom.rgb":
      return haStateToRgbState(haState);
    default:
      throw new Error(`Unknown device ID: ${deviceId}`);
  }
}

export function commandToServiceCalls(
  deviceId: DeviceId,
  entityId: string,
  command: DeviceCommand,
): ServiceCallSpec[] {
  const calls: ServiceCallSpec[] = [];

  switch (deviceId) {
    case "bedroom.ac": {
      const acCmd = command as AcCommand;
      if (acCmd.power === "off") {
        calls.push({
          domain: "climate",
          service: "turn_off",
          serviceData: { entity_id: entityId },
        });
        break;
      }

      if (acCmd.power === "on") {
        calls.push({
          domain: "climate",
          service: "turn_on",
          serviceData: { entity_id: entityId },
        });
      }

      if (acCmd.mode) {
        const hvacMode = acCmd.mode === "fan" ? "fan_only" : acCmd.mode;
        calls.push({
          domain: "climate",
          service: "set_hvac_mode",
          serviceData: { entity_id: entityId, hvac_mode: hvacMode },
        });
      }

      if (acCmd.temperature !== undefined) {
        calls.push({
          domain: "climate",
          service: "set_temperature",
          serviceData: { entity_id: entityId, temperature: acCmd.temperature },
        });
      }

      if (acCmd.fanSpeed !== undefined) {
        const fanModeMap: Record<number, string> = {
          1: "low",
          2: "medium-low",
          3: "medium",
          4: "medium-high",
          5: "high",
        };
        calls.push({
          domain: "climate",
          service: "set_fan_mode",
          serviceData: {
            entity_id: entityId,
            fan_mode: fanModeMap[acCmd.fanSpeed] ?? "medium",
          },
        });
      }
      break;
    }

    case "bedroom.fan": {
      const fanCmd = command as FanCommand;
      if (fanCmd.power === "off") {
        calls.push({
          domain: "fan",
          service: "turn_off",
          serviceData: { entity_id: entityId },
        });
        break;
      }

      const serviceData: Record<string, unknown> = { entity_id: entityId };
      if (fanCmd.speed !== undefined) {
        serviceData.percentage = Math.max(1, Math.min(100, fanCmd.speed * 20));
      }

      calls.push({
        domain: "fan",
        service: "turn_on",
        serviceData,
      });
      break;
    }

    case "bedroom.lights": {
      const lightCmd = command as LightsCommand;
      if (lightCmd.power === "off") {
        calls.push({
          domain: "light",
          service: "turn_off",
          serviceData: { entity_id: entityId },
        });
        break;
      }

      const serviceData: Record<string, unknown> = { entity_id: entityId };
      if (lightCmd.brightness !== undefined) {
        serviceData.brightness = Math.round((lightCmd.brightness / 100) * 255);
      }

      calls.push({
        domain: "light",
        service: "turn_on",
        serviceData,
      });
      break;
    }

    case "bedroom.rgb": {
      const rgbCmd = command as RgbCommand;
      if (rgbCmd.power === "off") {
        calls.push({
          domain: "light",
          service: "turn_off",
          serviceData: { entity_id: entityId },
        });
        break;
      }

      const serviceData: Record<string, unknown> = { entity_id: entityId };
      if (rgbCmd.brightness !== undefined) {
        serviceData.brightness = Math.round((rgbCmd.brightness / 100) * 255);
      }
      if (rgbCmd.color !== undefined) {
        serviceData.rgb_color = [rgbCmd.color.r, rgbCmd.color.g, rgbCmd.color.b];
      }

      calls.push({
        domain: "light",
        service: "turn_on",
        serviceData,
      });
      break;
    }

    default:
      throw new Error(`Unknown device ID for translation: ${deviceId}`);
  }

  return calls;
}
