import { DEVICE_IDS, type DeviceId } from "../types.js";

export const DEFAULT_DEVICE_TO_ENTITY_MAP: Record<DeviceId, string> = {
  "bedroom.ac": "climate.bedroom_ac",
  "bedroom.fan": "fan.bedroom_fan",
  "bedroom.lights": "light.bedroom_lights",
  "bedroom.rgb": "light.bedroom_rgb",
  "hall.ac": "remote.pathu",
};

/** Home Assistant domain each canonical device must map to. */
export const EXPECTED_DOMAIN: Record<DeviceId, string> = {
  "bedroom.ac": "climate",
  "bedroom.fan": "fan",
  "bedroom.lights": "light",
  "bedroom.rgb": "light",
  "hall.ac": "remote",
};

/** The only services Pathu may call, per domain. */
export const ALLOWED_SERVICES: Record<string, readonly string[]> = {
  climate: ["turn_on", "turn_off", "set_hvac_mode", "set_temperature", "set_fan_mode"],
  fan: ["turn_on", "turn_off"],
  light: ["turn_on", "turn_off"],
  remote: ["send_command", "turn_on", "turn_off"],
};

const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;

export class DeviceMapping {
  private readonly deviceToEntity = new Map<DeviceId, string>();
  private readonly entityToDevice = new Map<string, DeviceId>();

  constructor(customMap?: Partial<Record<DeviceId, string>>) {
    const combined = { ...DEFAULT_DEVICE_TO_ENTITY_MAP, ...customMap };
    for (const deviceId of DEVICE_IDS) {
      const entityId = combined[deviceId];
      if (!ENTITY_ID.test(entityId)) {
        throw new Error(`Invalid Home Assistant entity id configured for ${deviceId}`);
      }
      if (entityId.split(".")[0] !== EXPECTED_DOMAIN[deviceId]) {
        throw new Error(
          `Home Assistant entity for ${deviceId} must be in the "${EXPECTED_DOMAIN[deviceId]}" domain`,
        );
      }
      if (this.entityToDevice.has(entityId)) {
        throw new Error(`Home Assistant entity for ${deviceId} is already mapped to another device`);
      }
      this.deviceToEntity.set(deviceId, entityId);
      this.entityToDevice.set(entityId, deviceId);
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

  entityIds(): string[] {
    return [...this.deviceToEntity.values()];
  }

  /** True only for an allowlisted service in the device's own domain. */
  isAllowedCall(deviceId: DeviceId, domain: string, service: string): boolean {
    return (
      domain === EXPECTED_DOMAIN[deviceId] && (ALLOWED_SERVICES[domain] ?? []).includes(service)
    );
  }
}
