import type { DeviceAdapter, DeviceCommand, DeviceId, DeviceState } from "../types.js";
import type { HomeAssistantClient } from "./client.js";
import { DeviceMapping } from "./mapping.js";
import { commandToServiceCalls, haStateToDeviceState } from "./translate.js";

export interface HomeAssistantAdapterOptions {
  client: HomeAssistantClient;
  mapping?: DeviceMapping;
}

export class HomeAssistantAdapter implements DeviceAdapter {
  private readonly client: HomeAssistantClient;
  private readonly mapping: DeviceMapping;

  constructor(options: HomeAssistantAdapterOptions) {
    this.client = options.client;
    this.mapping = options.mapping ?? new DeviceMapping();
  }

  async get(id: DeviceId): Promise<DeviceState> {
    const entityId = this.mapping.getEntityId(id);
    const haState = await this.client.getEntityState(entityId);
    return haStateToDeviceState(id, haState);
  }

  async set(id: DeviceId, command: DeviceCommand): Promise<DeviceState> {
    const entityId = this.mapping.getEntityId(id);
    const serviceCalls = commandToServiceCalls(id, entityId, command);

    for (const call of serviceCalls) {
      await this.client.callService(call.domain, call.service, call.serviceData);
    }

    // Fetch updated state after executing service calls
    return this.get(id);
  }
}
