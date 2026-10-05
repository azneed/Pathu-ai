export const DEVICE_IDS = [
  "bedroom.ac",
  "bedroom.fan",
  "bedroom.lights",
  "bedroom.rgb",
] as const;

export type DeviceId = (typeof DEVICE_IDS)[number];

export type DeviceKind = "ac" | "fan" | "lights" | "rgb";

export type AcMode = "cool" | "heat" | "fan" | "auto" | "dry";

export interface AcState {
  power: "on" | "off";
  temperature: number;
  mode: AcMode;
  fanSpeed: number;
}

export interface FanState {
  power: "on" | "off";
  speed: number;
}

export interface LightsState {
  power: "on" | "off";
  brightness: number;
}

export interface RgbState {
  power: "on" | "off";
  brightness: number;
  color: { r: number; g: number; b: number };
}

export type DeviceState = AcState | FanState | LightsState | RgbState;

export type AcCommand = Partial<AcState>;
export type FanCommand = Partial<FanState>;
export type LightsCommand = Partial<LightsState>;
export type RgbCommand = Partial<RgbState>;
export type DeviceCommand = AcCommand | FanCommand | LightsCommand | RgbCommand;

/** Snapshot entry for a device whose state could not be read right now. */
export interface UnavailableDevice {
  status: "unavailable";
}

export type DeviceSnapshotEntry = DeviceState | UnavailableDevice;
export type DeviceSnapshot = Record<DeviceId, DeviceSnapshotEntry>;

export function isUnavailableDevice(
  entry: DeviceSnapshotEntry,
): entry is UnavailableDevice {
  return (entry as Partial<UnavailableDevice>).status === "unavailable";
}

export interface DeviceAdapter {
  get(id: DeviceId): Promise<DeviceState>;
  set(id: DeviceId, command: DeviceCommand): Promise<DeviceState>;
  /**
   * Optional batched read. Devices that cannot be read are returned as unavailable (or omitted);
   * a rejected promise marks every requested device unavailable.
   */
  getMany?(
    ids: readonly DeviceId[],
  ): Promise<Partial<Record<DeviceId, DeviceSnapshotEntry>>>;
}

export interface DeviceRecord {
  id: DeviceId;
  kind: DeviceKind;
  adapter: DeviceAdapter;
}

export interface DeviceGateway {
  get(id: DeviceId): Promise<DeviceState>;
  set(id: DeviceId, command: DeviceCommand): Promise<DeviceState>;
  /** Never rejects because of a device backend failure; unreadable devices are unavailable. */
  getAll(): Promise<DeviceSnapshot>;
}

export const DEFAULT_STATES: Record<DeviceId, DeviceState> = {
  "bedroom.ac": {
    power: "off",
    temperature: 24,
    mode: "cool",
    fanSpeed: 2,
  },
  "bedroom.fan": {
    power: "off",
    speed: 1,
  },
  "bedroom.lights": {
    power: "off",
    brightness: 100,
  },
  "bedroom.rgb": {
    power: "off",
    brightness: 100,
    color: { r: 255, g: 255, b: 255 },
  },
};

export function isDeviceId(value: string): value is DeviceId {
  return (DEVICE_IDS as readonly string[]).includes(value);
}
