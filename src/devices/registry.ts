import type { DeviceAdapter, DeviceId, DeviceRecord } from "./types.js";

export function createRegistry(adapter: DeviceAdapter): Map<DeviceId, DeviceRecord> {
  const entries: DeviceRecord[] = [
    { id: "bedroom.ac", kind: "ac", adapter },
    { id: "bedroom.fan", kind: "fan", adapter },
    { id: "bedroom.lights", kind: "lights", adapter },
    { id: "bedroom.rgb", kind: "rgb", adapter },
  ];

  return new Map(entries.map((entry) => [entry.id, entry]));
}
