import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import type { DeviceAdapter } from "./types.js";
import { SimulatedAdapter } from "./simulated.js";
import { HomeAssistantClient } from "./homeassistant/client.js";
import { HomeAssistantAdapter } from "./homeassistant/adapter.js";
import { DeviceMapping } from "./homeassistant/mapping.js";

export interface CreateDeviceAdapterOptions {
  config: Pick<
    Config,
    "DEVICE_BACKEND" | "HOME_ASSISTANT_URL" | "HOME_ASSISTANT_TOKEN" | "HOME_ASSISTANT_TIMEOUT_MS"
  >;
  db: Db;
  fetchImpl?: typeof fetch;
}

/** Builds exactly the configured backend; homeassistant mode never falls back to simulated. */
export function createDeviceAdapter(options: CreateDeviceAdapterOptions): DeviceAdapter {
  const { config } = options;
  switch (config.DEVICE_BACKEND) {
    case "simulated":
      return new SimulatedAdapter(options.db);
    case "homeassistant": {
      if (!config.HOME_ASSISTANT_URL || !config.HOME_ASSISTANT_TOKEN) {
        throw new Error(
          "DEVICE_BACKEND=homeassistant requires HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN",
        );
      }
      const client = new HomeAssistantClient({
        baseUrl: config.HOME_ASSISTANT_URL,
        token: config.HOME_ASSISTANT_TOKEN,
        timeoutMs: config.HOME_ASSISTANT_TIMEOUT_MS,
        fetchImpl: options.fetchImpl,
      });
      return new HomeAssistantAdapter({ client, mapping: new DeviceMapping() });
    }
    default: {
      const unknownBackend: never = config.DEVICE_BACKEND;
      throw new Error(`Unsupported DEVICE_BACKEND: ${String(unknownBackend)}`);
    }
  }
}
