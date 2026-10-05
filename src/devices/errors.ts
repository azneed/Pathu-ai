import type { DeviceId } from "./types.js";

/**
 * Device-level errors. Their messages reach the LLM, the chat history and API responses, so they
 * mention canonical device IDs only — never vendor entity IDs, URLs, tokens or response bodies.
 */

/** The device exists but its backend cannot report a usable state right now. */
export class DeviceUnavailableError extends Error {
  constructor(readonly deviceId: DeviceId) {
    super(`${deviceId} is unavailable right now`);
    this.name = "DeviceUnavailableError";
  }
}

/** The command cannot be applied as given (unsupported by the device, or contradictory). */
export class DeviceCommandError extends Error {
  constructor(
    readonly deviceId: DeviceId,
    reason: string,
    options?: ErrorOptions,
  ) {
    super(`${deviceId}: ${reason}`, options);
    this.name = "DeviceCommandError";
  }
}
