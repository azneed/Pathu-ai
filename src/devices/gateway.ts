import { isDeviceId, type DeviceCommand, type DeviceGateway, type DeviceId, type DeviceRecord, type DeviceState } from "./types.js";

export class Gateway implements DeviceGateway {
  constructor(private readonly registry: Map<DeviceId, DeviceRecord>) {}

  private resolve(id: DeviceId): DeviceRecord {
    const record = this.registry.get(id);
    if (!record) {
      throw new Error(`Unknown device id: ${id}`);
    }
    return record;
  }

  async get(id: DeviceId): Promise<DeviceState> {
    if (!isDeviceId(id)) {
      throw new Error(`Unknown device id: ${id}`);
    }
    const record = this.resolve(id);
    return record.adapter.get(id);
  }

  async set(id: DeviceId, command: DeviceCommand): Promise<DeviceState> {
    if (!isDeviceId(id)) {
      throw new Error(`Unknown device id: ${id}`);
    }
    const record = this.resolve(id);
    return record.adapter.set(id, command);
  }

  async getAll(): Promise<Record<DeviceId, DeviceState>> {
    const result = {} as Record<DeviceId, DeviceState>;
    for (const [id, record] of this.registry) {
      result[id] = await record.adapter.get(id);
    }
    return result;
  }
}
