import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import type { DeviceAdapter } from "./types.js";
import { SimulatedAdapter } from "./simulated.js";
import { HomeAssistantClient } from "./homeassistant/client.js";
import { HomeAssistantAdapter } from "./homeassistant/adapter.js";
import { DeviceMapping } from "./homeassistant/mapping.js";

export interface CreateDeviceAdapterOptions {
  config: Config;
  db: Db;
  fetchImpl?: typeof fetch;
}

export function createDeviceAdapter(options: CreateDeviceAdapterOptions): DeviceAdapter {
  const token = options.config.HOMEASSISTANT_TOKEN ?? process.env.HOMEASSISTANT_TOKEN ?? "";
  const baseUrl = options.config.HOMEASSISTANT_BASE_URL ?? process.env.HOMEASSISTANT_BASE_URL ?? "http://localhost:8123";

  if (token.trim().length > 0) {
    const client = new HomeAssistantClient({
      baseUrl,
      token,
      fetchImpl: options.fetchImpl,
    });
    const mapping = new DeviceMapping();
    return new HomeAssistantAdapter({ client, mapping });
  }

  return new SimulatedAdapter(options.db);
}
