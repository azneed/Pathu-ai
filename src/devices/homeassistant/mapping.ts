import type { DeviceId } from "../types.js";

export interface DeviceMappingConfig {
  [deviceId: string]: string;
}

export const DEFAULT_DEVICE_TO_ENTITY_MAP: Record<DeviceId, string> = {
  "bedroom.ac": "climate.bedroom_ac",
  "bedroom.fan": "fan.bedroom_fan",
  "bedroom.lights": "light.bedroom_lights",
  "bedroom.rgb": "light.bedroom_rgb",
};

export class DeviceMapping {
  private readonly deviceToEntity: Map<DeviceId, string>;
  private readonly entityToDevice: Map<string, DeviceId>;

  constructor(customMap?: Partial<Record<DeviceId, string>>) {
    const combined = { ...DEFAULT_DEVICE_TO_ENTITY_MAP, ...customMap };
    this.deviceToEntity = new Map();
    this.entityToDevice = new Map();

    for (const [device, entity] of Object.entries(combined)) {
      const devId = device as DeviceId;
      this.deviceToEntity.set(devId, entity);
      this.entityToDevice.set(entity, devId);
    }
  }

  getEntityId(deviceId: DeviceId): string {
    const entityId = this.deviceToEntity.get(deviceId);
    if (!entityId) {
      throw new Error(`No Home Assistant entity mapped for device ID: ${deviceId}`);
    }
    return entityId;
  }

  getDeviceId(entityId: string): DeviceId | undefined {
    return this.entityToDevice.get(entityId);
  }
}
