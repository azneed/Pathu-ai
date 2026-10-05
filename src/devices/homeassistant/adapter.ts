import { DeviceCommandError } from "../errors.js";
import type {
  DeviceAdapter,
  DeviceCommand,
  DeviceId,
  DeviceSnapshotEntry,
  DeviceState,
} from "../types.js";
import { HomeAssistantError, type HaEntityState, type HomeAssistantClient } from "./client.js";
import { DeviceMapping } from "./mapping.js";
import { commandToServiceCalls, haStateToDeviceState } from "./translate.js";

export interface HomeAssistantAdapterOptions {
  client: HomeAssistantClient;
  mapping?: DeviceMapping;
  /** How long a read is reused by snapshots and command capability checks. */
  cacheTtlMs?: number;
  now?: () => number;
}

interface CachedState {
  state: HaEntityState;
  fetchedAt: number;
}

const DEFAULT_CACHE_TTL_MS = 3000;

/** Safe text for a failure: HomeAssistantError/device messages are safe, anything else is not shown. */
function safeReason(error: unknown): string {
  if (error instanceof HomeAssistantError || error instanceof DeviceCommandError) {
    return error.message;
  }
  return "unexpected Home Assistant error";
}

export class HomeAssistantAdapter implements DeviceAdapter {
  private readonly client: HomeAssistantClient;
  private readonly mapping: DeviceMapping;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CachedState>();
  private bulkRead: Promise<void> | null = null;

  constructor(options: HomeAssistantAdapterOptions) {
    this.client = options.client;
    this.mapping = options.mapping ?? new DeviceMapping();
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async get(id: DeviceId): Promise<DeviceState> {
    const state = await this.readEntity(this.mapping.getEntityId(id));
    return haStateToDeviceState(id, state);
  }

  /** One bulk /api/states read (or none while the cache is fresh) for all requested devices. */
  async getMany(ids: readonly DeviceId[]): Promise<Partial<Record<DeviceId, DeviceSnapshotEntry>>> {
    const entityIds = ids.map((id) => this.mapping.getEntityId(id));
    if (!entityIds.every((entityId) => this.freshEntry(entityId))) {
      await this.refreshAll();
    }

    const result: Partial<Record<DeviceId, DeviceSnapshotEntry>> = {};
    ids.forEach((id, index) => {
      const cached = this.freshEntry(entityIds[index]!);
      if (!cached) {
        result[id] = { status: "unavailable" };
        return;
      }
      try {
        result[id] = haStateToDeviceState(id, cached.state);
      } catch {
        result[id] = { status: "unavailable" };
      }
    });
    return result;
  }

  async set(id: DeviceId, command: DeviceCommand): Promise<DeviceState> {
    const entityId = this.mapping.getEntityId(id);

    let current: HaEntityState;
    try {
      current = await this.readEntity(entityId);
    } catch (error) {
      throw new DeviceCommandError(id, safeReason(error), { cause: error });
    }
    // Rejects unavailable/unknown entities before anything is sent.
    haStateToDeviceState(id, current);

    const calls = commandToServiceCalls(id, entityId, command, current);
    for (const call of calls) {
      if (
        !this.mapping.isAllowedCall(id, call.domain, call.service) ||
        call.serviceData.entity_id !== entityId
      ) {
        throw new DeviceCommandError(id, "command translated to a call that is not allowed");
      }
    }

    this.cache.delete(entityId);
    for (let step = 0; step < calls.length; step += 1) {
      const call = calls[step]!;
      try {
        await this.client.callService(call.domain, call.service, call.serviceData);
      } catch (error) {
        const progress =
          calls.length > 1
            ? ` (step ${step + 1} of ${calls.length} failed; ${step} earlier step${step === 1 ? " was" : "s were"} applied)`
            : "";
        throw new DeviceCommandError(id, `${safeReason(error)}${progress}`, { cause: error });
      }
    }

    let updated: HaEntityState;
    try {
      updated = await this.fetchEntity(entityId);
    } catch (error) {
      throw new DeviceCommandError(
        id,
        `command was sent but the new state could not be read: ${safeReason(error)}`,
        { cause: error },
      );
    }
    return haStateToDeviceState(id, updated);
  }

  private freshEntry(entityId: string): CachedState | undefined {
    const cached = this.cache.get(entityId);
    if (!cached || this.now() - cached.fetchedAt > this.cacheTtlMs) return undefined;
    return cached;
  }

  private async readEntity(entityId: string): Promise<HaEntityState> {
    return this.freshEntry(entityId)?.state ?? this.fetchEntity(entityId);
  }

  private async fetchEntity(entityId: string): Promise<HaEntityState> {
    const state = await this.client.getEntityState(entityId);
    this.cache.set(entityId, { state, fetchedAt: this.now() });
    return state;
  }

  /** Concurrent snapshot requests share one in-flight bulk read. */
  private refreshAll(): Promise<void> {
    this.bulkRead ??= (async () => {
      try {
        const entityIds = this.mapping.entityIds();
        const states = await this.client.getEntityStates(entityIds);
        const fetchedAt = this.now();
        for (const entityId of entityIds) {
          const state = states.get(entityId);
          if (state) this.cache.set(entityId, { state, fetchedAt });
          else this.cache.delete(entityId);
        }
      } finally {
        this.bulkRead = null;
      }
    })();
    return this.bulkRead;
  }
}
