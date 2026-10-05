import {
  isDeviceId,
  isUnavailableDevice,
  type DeviceAdapter,
  type DeviceCommand,
  type DeviceGateway,
  type DeviceId,
  type DeviceRecord,
  type DeviceSnapshot,
  type DeviceSnapshotEntry,
  type DeviceState,
} from "./types.js";

export type DeviceReadErrorHandler = (ids: readonly DeviceId[], error: unknown) => void;

export interface GatewayOptions {
  /** Called when devices cannot be read for a snapshot. Default: a console warning. */
  onReadError?: DeviceReadErrorHandler;
}

/** Device/backend errors carry safe messages; anything else is reduced to its name. */
function describeReadError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

const defaultReadErrorHandler: DeviceReadErrorHandler = (ids, error) => {
  console.warn(`[devices] state unavailable for ${ids.join(", ")}: ${describeReadError(error)}`);
};

export class Gateway implements DeviceGateway {
  private readonly onReadError: DeviceReadErrorHandler;

  constructor(
    private readonly registry: Map<DeviceId, DeviceRecord>,
    options: GatewayOptions = {},
  ) {
    this.onReadError = options.onReadError ?? defaultReadErrorHandler;
  }

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

  async getAll(): Promise<DeviceSnapshot> {
    const idsByAdapter = new Map<DeviceAdapter, DeviceId[]>();
    for (const [id, record] of this.registry) {
      const ids = idsByAdapter.get(record.adapter) ?? [];
      ids.push(id);
      idsByAdapter.set(record.adapter, ids);
    }

    const entries = new Map<DeviceId, DeviceSnapshotEntry>();
    await Promise.all(
      [...idsByAdapter].map(([adapter, ids]) => this.readAdapter(adapter, ids, entries)),
    );

    const result = {} as DeviceSnapshot;
    for (const id of this.registry.keys()) {
      result[id] = entries.get(id) ?? { status: "unavailable" };
    }
    return result;
  }

  private async readAdapter(
    adapter: DeviceAdapter,
    ids: DeviceId[],
    out: Map<DeviceId, DeviceSnapshotEntry>,
  ): Promise<void> {
    if (adapter.getMany) {
      try {
        const states = await adapter.getMany(ids);
        const unavailable: DeviceId[] = [];
        for (const id of ids) {
          const entry = states[id];
          if (entry) out.set(id, entry);
          if (!entry || isUnavailableDevice(entry)) unavailable.push(id);
        }
        if (unavailable.length > 0) {
          this.onReadError(unavailable, new Error("backend reported no usable state"));
        }
      } catch (error) {
        this.onReadError(ids, error);
      }
      return;
    }

    await Promise.all(
      ids.map(async (id) => {
        try {
          out.set(id, await adapter.get(id));
        } catch (error) {
          this.onReadError([id], error);
        }
      }),
    );
  }
}
