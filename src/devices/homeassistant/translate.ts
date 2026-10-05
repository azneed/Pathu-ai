import { DeviceCommandError, DeviceUnavailableError } from "../errors.js";
import {
  DEFAULT_STATES,
  type AcCommand,
  type AcMode,
  type AcState,
  type DeviceCommand,
  type DeviceId,
  type DeviceState,
  type FanCommand,
  type FanState,
  type LightsCommand,
  type LightsState,
  type RgbCommand,
  type RgbState,
} from "../types.js";
import type { HaEntityState } from "./client.js";

export interface ServiceCallSpec {
  domain: string;
  service: string;
  serviceData: Record<string, unknown>;
}

/** Home Assistant `supported_features` bits (ClimateEntityFeature / FanEntityFeature). */
const CLIMATE_TARGET_TEMPERATURE = 1;
const CLIMATE_FAN_MODE = 8;
const CLIMATE_TURN_OFF = 128;
const CLIMATE_TURN_ON = 256;
const FAN_SET_SPEED = 1;

const UNAVAILABLE_STATES = new Set(["unavailable", "unknown"]);
const COLOR_MODES = new Set(["hs", "xy", "rgb", "rgbw", "rgbww"]);

const DEFAULT_AC = DEFAULT_STATES["bedroom.ac"] as AcState;
const DEFAULT_FAN = DEFAULT_STATES["bedroom.fan"] as FanState;
const DEFAULT_RGB = DEFAULT_STATES["bedroom.rgb"] as RgbState;

const HVAC_TO_PATHU: Record<string, AcMode> = {
  cool: "cool",
  heat: "heat",
  fan_only: "fan",
  dry: "dry",
  auto: "auto",
  heat_cool: "auto",
};

/** HA hvac modes accepted for each Pathu mode, in order of preference. */
const PATHU_TO_HVAC: Record<AcMode, readonly string[]> = {
  cool: ["cool"],
  heat: ["heat"],
  fan: ["fan_only"],
  dry: ["dry"],
  auto: ["auto", "heat_cool"],
};

/** Mode used to switch the AC on when no mode was requested and turn_on is unsupported. */
const POWER_ON_HVAC_PREFERENCE = ["cool", "heat_cool", "auto", "heat", "dry", "fan_only"];

/**
 * Relative level of common climate fan_mode names. Modes not listed (auto, quiet, turbo, ...)
 * are special functions, not steps on the speed ladder.
 */
const FAN_MODE_LEVELS: Record<string, number> = {
  lowest: 0.5,
  min: 0.6,
  low: 1,
  low_medium: 2,
  medium_low: 2,
  mid_low: 2,
  middle_low: 2,
  medium: 3,
  mid: 3,
  middle: 3,
  medium_high: 4,
  mid_high: 4,
  middle_high: 4,
  high_medium: 4,
  high: 5,
  highest: 5.5,
  max: 5.6,
  maximum: 5.6,
};

function hasFeature(state: HaEntityState, bit: number): boolean | undefined {
  const features = state.attributes.supported_features;
  return typeof features === "number" ? (features & bit) !== 0 : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function brightnessPercent(raw: unknown, power: "on" | "off", fallback: number): number {
  if (typeof raw === "number") {
    return Math.max(0, Math.min(100, Math.round((raw / 255) * 100)));
  }
  return power === "off" ? 0 : fallback;
}

function fanModeLevel(mode: string): number | undefined {
  if (/^\d+$/.test(mode)) return Number(mode);
  return FAN_MODE_LEVELS[mode.trim().toLowerCase().replace(/[\s-]+/g, "_")];
}

/** The entity's own fan_modes that form a speed ladder, slowest first. */
export function fanSpeedLadder(fanModes: readonly string[]): string[] {
  return fanModes
    .map((mode, index) => ({ mode, index, level: fanModeLevel(mode) }))
    .filter((entry): entry is { mode: string; index: number; level: number } => entry.level !== undefined)
    .sort((a, b) => a.level - b.level || a.index - b.index)
    .map((entry) => entry.mode);
}

/** Pathu fanSpeed 1-5 spread evenly over the ladder; undefined when the ladder is empty. */
export function speedToFanMode(speed: number, fanModes: readonly string[]): string | undefined {
  const ladder = fanSpeedLadder(fanModes);
  if (ladder.length === 0) return undefined;
  const index = Math.round(((speed - 1) * (ladder.length - 1)) / 4);
  return ladder[Math.max(0, Math.min(ladder.length - 1, index))];
}

export function fanModeToSpeed(mode: unknown, fanModes: readonly string[]): number | undefined {
  if (typeof mode !== "string") return undefined;
  const ladder = fanSpeedLadder(fanModes);
  const index = ladder.indexOf(mode);
  if (index < 0) return undefined;
  if (ladder.length === 1) return 1;
  return 1 + Math.round((index * 4) / (ladder.length - 1));
}

export function haStateToAcState(haState: HaEntityState): AcState {
  const attrs = haState.attributes;
  const power = haState.state === "off" ? "off" : "on";
  const mode = HVAC_TO_PATHU[haState.state] ?? DEFAULT_AC.mode;

  // Target setpoint only; current_temperature is the measured room temperature.
  let temperature = DEFAULT_AC.temperature;
  if (typeof attrs.temperature === "number") {
    temperature = Math.round(attrs.temperature);
  } else if (typeof attrs.target_temp_low === "number" && typeof attrs.target_temp_high === "number") {
    temperature = Math.round((attrs.target_temp_low + attrs.target_temp_high) / 2);
  }

  const fanSpeed = fanModeToSpeed(attrs.fan_mode, stringList(attrs.fan_modes)) ?? DEFAULT_AC.fanSpeed;
  return { power, temperature, mode, fanSpeed };
}

export function haStateToFanState(haState: HaEntityState): FanState {
  const power = haState.state === "on" ? "on" : "off";
  const pct = haState.attributes.percentage;
  const speed =
    typeof pct === "number" && pct > 0
      ? Math.max(1, Math.min(5, Math.ceil(pct / 20)))
      : DEFAULT_FAN.speed;
  return { power, speed };
}

export function haStateToLightsState(haState: HaEntityState): LightsState {
  const power = haState.state === "on" ? "on" : "off";
  return { power, brightness: brightnessPercent(haState.attributes.brightness, power, 100) };
}

export function haStateToRgbState(haState: HaEntityState): RgbState {
  const power = haState.state === "on" ? "on" : "off";
  const brightness = brightnessPercent(haState.attributes.brightness, power, 100);

  let color = { ...DEFAULT_RGB.color };
  const rawRgb = haState.attributes.rgb_color;
  if (Array.isArray(rawRgb) && rawRgb.length >= 3) {
    const channel = (value: unknown) =>
      Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
    color = { r: channel(rawRgb[0]), g: channel(rawRgb[1]), b: channel(rawRgb[2]) };
  }
  return { power, brightness, color };
}

export function haStateToHallAcState(haState: HaEntityState): AcState {
  return {
    power: "off",
    temperature: 24,
    mode: "cool",
    fanSpeed: 2,
    powerStateUnconfirmed: true,
  };
}

/** Throws DeviceUnavailableError for HA `unavailable` / `unknown` instead of guessing a power state. */
export function haStateToDeviceState(deviceId: DeviceId, haState: HaEntityState): DeviceState {
  if (UNAVAILABLE_STATES.has(haState.state)) {
    throw new DeviceUnavailableError(deviceId);
  }
  switch (deviceId) {
    case "bedroom.ac":
      return haStateToAcState(haState);
    case "hall.ac":
      return haStateToHallAcState(haState);
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

function acCalls(
  deviceId: DeviceId,
  entityId: string,
  command: AcCommand,
  current: HaEntityState,
): ServiceCallSpec[] {
  const hvacModes = stringList(current.attributes.hvac_modes);
  const others = (["temperature", "mode", "fanSpeed"] as const).filter((key) => command[key] !== undefined);

  if (command.power === "off") {
    if (others.length > 0) {
      throw new DeviceCommandError(
        deviceId,
        `turning the AC off cannot be combined with ${others.join(", ")}; send those as a separate command`,
      );
    }
    if (hasFeature(current, CLIMATE_TURN_OFF) === true) {
      return [{ domain: "climate", service: "turn_off", serviceData: { entity_id: entityId } }];
    }
    if (hvacModes.length > 0 && !hvacModes.includes("off")) {
      throw new DeviceCommandError(deviceId, "this AC cannot be turned off remotely");
    }
    return [
      { domain: "climate", service: "set_hvac_mode", serviceData: { entity_id: entityId, hvac_mode: "off" } },
    ];
  }

  const calls: ServiceCallSpec[] = [];

  // Setting an hvac mode also switches a climate entity on, so it doubles as power-on.
  if (command.mode !== undefined) {
    const candidates = PATHU_TO_HVAC[command.mode];
    const hvacMode =
      hvacModes.length === 0 ? candidates[0] : candidates.find((mode) => hvacModes.includes(mode));
    if (!hvacMode) {
      throw new DeviceCommandError(deviceId, `mode "${command.mode}" is not supported by this AC`);
    }
    calls.push({
      domain: "climate",
      service: "set_hvac_mode",
      serviceData: { entity_id: entityId, hvac_mode: hvacMode },
    });
  } else if (command.power === "on") {
    if (hasFeature(current, CLIMATE_TURN_ON) === true) {
      calls.push({ domain: "climate", service: "turn_on", serviceData: { entity_id: entityId } });
    } else {
      const hvacMode =
        Object.hasOwn(HVAC_TO_PATHU, current.state)
          ? current.state
          : hvacModes.length === 0
            ? "cool"
            : POWER_ON_HVAC_PREFERENCE.find((mode) => hvacModes.includes(mode));
      if (!hvacMode) {
        throw new DeviceCommandError(deviceId, "this AC has no operating mode to turn on with");
      }
      calls.push({
        domain: "climate",
        service: "set_hvac_mode",
        serviceData: { entity_id: entityId, hvac_mode: hvacMode },
      });
    }
  }

  if (command.temperature !== undefined) {
    if (hasFeature(current, CLIMATE_TARGET_TEMPERATURE) === false) {
      throw new DeviceCommandError(deviceId, "this AC does not support setting a temperature");
    }
    calls.push({
      domain: "climate",
      service: "set_temperature",
      serviceData: { entity_id: entityId, temperature: command.temperature },
    });
  }

  if (command.fanSpeed !== undefined) {
    const fanMode =
      hasFeature(current, CLIMATE_FAN_MODE) === false
        ? undefined
        : speedToFanMode(command.fanSpeed, stringList(current.attributes.fan_modes));
    if (!fanMode) {
      throw new DeviceCommandError(deviceId, "this AC does not support fan speed control");
    }
    calls.push({
      domain: "climate",
      service: "set_fan_mode",
      serviceData: { entity_id: entityId, fan_mode: fanMode },
    });
  }

  return calls;
}

function fanCalls(
  deviceId: DeviceId,
  entityId: string,
  command: FanCommand,
  current: HaEntityState,
): ServiceCallSpec[] {
  if (command.power === "off") {
    if (command.speed !== undefined) {
      throw new DeviceCommandError(
        deviceId,
        "turning the fan off cannot be combined with a speed; send the speed as a separate command",
      );
    }
    return [{ domain: "fan", service: "turn_off", serviceData: { entity_id: entityId } }];
  }

  const serviceData: Record<string, unknown> = { entity_id: entityId };
  if (command.speed !== undefined) {
    if (hasFeature(current, FAN_SET_SPEED) !== true) {
      throw new DeviceCommandError(deviceId, "this fan does not support speed control");
    }
    serviceData.percentage = Math.max(1, Math.min(100, command.speed * 20));
  }
  return [{ domain: "fan", service: "turn_on", serviceData }];
}

function lightCalls(
  deviceId: DeviceId,
  entityId: string,
  command: LightsCommand & Pick<RgbCommand, "color">,
  current: HaEntityState,
  label: "light" | "RGB light",
): ServiceCallSpec[] {
  const turnOff = [{ domain: "light", service: "turn_off", serviceData: { entity_id: entityId } }];
  const colorModes = stringList(current.attributes.supported_color_modes);

  if (command.power === "off") {
    const conflicting = [
      command.brightness !== undefined && command.brightness !== 0 ? "brightness" : null,
      command.color !== undefined ? "color" : null,
    ].filter((field): field is string => field !== null);
    if (conflicting.length > 0) {
      throw new DeviceCommandError(
        deviceId,
        `turning the ${label} off cannot be combined with ${conflicting.join(", ")}; send those as a separate command`,
      );
    }
    return turnOff;
  }

  // Home Assistant switches a light off at brightness 0.
  if (command.brightness === 0 && command.color === undefined) {
    return turnOff;
  }

  const serviceData: Record<string, unknown> = { entity_id: entityId };
  if (command.brightness !== undefined) {
    if (colorModes.length > 0 && colorModes.every((mode) => mode === "onoff")) {
      throw new DeviceCommandError(deviceId, `this ${label} does not support brightness`);
    }
    serviceData.brightness = Math.round((command.brightness / 100) * 255);
  }
  if (command.color !== undefined) {
    if (colorModes.length > 0 && !colorModes.some((mode) => COLOR_MODES.has(mode))) {
      throw new DeviceCommandError(deviceId, `this ${label} does not support color`);
    }
    serviceData.rgb_color = [command.color.r, command.color.g, command.color.b];
  }
  return [{ domain: "light", service: "turn_on", serviceData }];
}

function hallAcCalls(
  deviceId: DeviceId,
  entityId: string,
  command: AcCommand,
): ServiceCallSpec[] {
  const unsupported = (["temperature", "mode", "fanSpeed"] as const).filter(
    (key) => command[key] !== undefined,
  );
  if (unsupported.length > 0) {
    throw new DeviceCommandError(
      deviceId,
      `Hall AC only supports power ON/OFF in this version (cannot set ${unsupported.join(", ")})`,
    );
  }

  if (command.power !== "on" && command.power !== "off") {
    throw new DeviceCommandError(deviceId, "Hall AC command requires power to be 'on' or 'off'");
  }

  return [
    {
      domain: "remote",
      service: "send_command",
      serviceData: {
        entity_id: entityId,
        device: "Air conditioner - Hall",
        command: "power",
      },
    },
  ];
}

/**
 * Translate a validated Pathu command into Home Assistant service calls, using the entity's
 * current state for its capabilities. Throws DeviceCommandError for unsupported or contradictory
 * commands rather than silently dropping fields.
 */
export function commandToServiceCalls(
  deviceId: DeviceId,
  entityId: string,
  command: DeviceCommand,
  current: HaEntityState,
): ServiceCallSpec[] {
  switch (deviceId) {
    case "bedroom.ac":
      return acCalls(deviceId, entityId, command as AcCommand, current);
    case "hall.ac":
      return hallAcCalls(deviceId, entityId, command as AcCommand);
    case "bedroom.fan":
      return fanCalls(deviceId, entityId, command as FanCommand, current);
    case "bedroom.lights":
      return lightCalls(deviceId, entityId, command as LightsCommand, current, "light");
    case "bedroom.rgb":
      return lightCalls(deviceId, entityId, command as RgbCommand, current, "RGB light");
    default:
      throw new Error(`Unknown device ID for translation: ${deviceId}`);
  }
}
