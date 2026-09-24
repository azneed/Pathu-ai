import type { Db } from "../db/index.js";
import {
  DEFAULT_STATES,
  DEVICE_IDS,
  type AcCommand,
  type AcState,
  type DeviceAdapter,
  type DeviceCommand,
  type DeviceId,
  type DeviceKind,
  type DeviceState,
  type FanCommand,
  type FanState,
  type LightsCommand,
  type LightsState,
  type RgbCommand,
  type RgbState,
} from "./types.js";

const KIND_BY_ID: Record<DeviceId, DeviceKind> = {
  "bedroom.ac": "ac",
  "bedroom.fan": "fan",
  "bedroom.lights": "lights",
  "bedroom.rgb": "rgb",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function assertIntegerInRange(
  label: string,
  value: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  if (value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return value;
}

function applyAc(state: AcState, command: AcCommand): AcState {
  const next: AcState = { ...state };
  if (command.power !== undefined) {
    if (command.power !== "on" && command.power !== "off") {
      throw new Error('AC power must be "on" or "off"');
    }
    next.power = command.power;
  }
  if (command.temperature !== undefined) {
    next.temperature = assertIntegerInRange(
      "AC temperature",
      command.temperature,
      16,
      30,
    );
  }
  if (command.mode !== undefined) {
    const allowed = ["cool", "heat", "fan", "auto", "dry"] as const;
    if (!allowed.includes(command.mode)) {
      throw new Error(`AC mode must be one of: ${allowed.join(", ")}`);
    }
    next.mode = command.mode;
  }
  if (command.fanSpeed !== undefined) {
    next.fanSpeed = assertIntegerInRange("AC fanSpeed", command.fanSpeed, 1, 5);
  }
  return next;
}

function applyFan(state: FanState, command: FanCommand): FanState {
  const next: FanState = { ...state };
  if (command.power !== undefined) {
    if (command.power !== "on" && command.power !== "off") {
      throw new Error('Fan power must be "on" or "off"');
    }
    next.power = command.power;
  }
  if (command.speed !== undefined) {
    next.speed = assertIntegerInRange("Fan speed", command.speed, 1, 5);
  }
  return next;
}

function applyLights(state: LightsState, command: LightsCommand): LightsState {
  const next: LightsState = { ...state };
  if (command.power !== undefined) {
    if (command.power !== "on" && command.power !== "off") {
      throw new Error('Lights power must be "on" or "off"');
    }
    next.power = command.power;
  }
  if (command.brightness !== undefined) {
    next.brightness = assertIntegerInRange(
      "Lights brightness",
      command.brightness,
      0,
      100,
    );
  }
  return next;
}

function applyRgb(state: RgbState, command: RgbCommand): RgbState {
  const next: RgbState = {
    ...state,
    color: { ...state.color },
  };
  if (command.power !== undefined) {
    if (command.power !== "on" && command.power !== "off") {
      throw new Error('RGB power must be "on" or "off"');
    }
    next.power = command.power;
  }
  if (command.brightness !== undefined) {
    next.brightness = assertIntegerInRange(
      "RGB brightness",
      command.brightness,
      0,
      100,
    );
  }
  if (command.color !== undefined) {
    next.color = {
      r: clamp(assertIntegerInRange("color.r", command.color.r, 0, 255), 0, 255),
      g: clamp(assertIntegerInRange("color.g", command.color.g, 0, 255), 0, 255),
      b: clamp(assertIntegerInRange("color.b", command.color.b, 0, 255), 0, 255),
    };
  }
  return next;
}

export class SimulatedAdapter implements DeviceAdapter {
  private readonly states = new Map<DeviceId, DeviceState>();

  constructor(private readonly db: Db) {
    const stored = db.getAllDeviceStates();
    for (const id of DEVICE_IDS) {
      const existing = stored[id];
      const state = existing ?? structuredClone(DEFAULT_STATES[id]);
      this.states.set(id, state);
      if (!existing) {
        this.db.setDeviceState(id, state);
      }
    }
  }

  get(id: DeviceId): DeviceState {
    const state = this.states.get(id);
    if (!state) {
      throw new Error(`Unknown device: ${id}`);
    }
    return structuredClone(state);
  }

  set(id: DeviceId, command: DeviceCommand): DeviceState {
    const current = this.states.get(id);
    if (!current) {
      throw new Error(`Unknown device: ${id}`);
    }

    const kind = KIND_BY_ID[id];
    let next: DeviceState;

    switch (kind) {
      case "ac":
        next = applyAc(current as AcState, command as AcCommand);
        break;
      case "fan":
        next = applyFan(current as FanState, command as FanCommand);
        break;
      case "lights":
        next = applyLights(current as LightsState, command as LightsCommand);
        break;
      case "rgb":
        next = applyRgb(current as RgbState, command as RgbCommand);
        break;
      default: {
        const _exhaustive: never = kind;
        throw new Error(`Unhandled device kind: ${_exhaustive}`);
      }
    }

    this.states.set(id, next);
    this.db.setDeviceState(id, next);
    return structuredClone(next);
  }
}
