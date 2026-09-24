/**
 * In-memory provider availability / cooldown (no DB).
 * Used by ProviderRouter to skip recently rate-limited providers.
 */

export type CooldownReason =
  | "quota exhausted"
  | "rate limited"
  | "resource exhausted";

export interface ProviderCooldownState {
  provider: string;
  unavailableUntil: number;
  reason: CooldownReason;
}

export class ProviderCooldownRegistry {
  private readonly states = new Map<string, ProviderCooldownState>();

  markUnavailable(
    provider: string,
    cooldownSeconds: number,
    reason: CooldownReason,
    nowMs: number = Date.now(),
  ): ProviderCooldownState {
    const state: ProviderCooldownState = {
      provider,
      unavailableUntil: nowMs + Math.max(0, cooldownSeconds) * 1000,
      reason,
    };
    this.states.set(provider, state);
    return state;
  }

  clear(provider: string): void {
    this.states.delete(provider);
  }

  get(provider: string): ProviderCooldownState | undefined {
    return this.states.get(provider);
  }

  /** True if the provider may be called right now. */
  isAvailable(provider: string, nowMs: number = Date.now()): boolean {
    const state = this.states.get(provider);
    if (!state) return true;
    if (nowMs >= state.unavailableUntil) {
      this.states.delete(provider);
      return true;
    }
    return false;
  }

  remainingSeconds(provider: string, nowMs: number = Date.now()): number {
    const state = this.states.get(provider);
    if (!state) return 0;
    return Math.max(0, Math.ceil((state.unavailableUntil - nowMs) / 1000));
  }
}

export function extractErrorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.status === "number") return record.status;
    if (typeof record.statusCode === "number") return record.statusCode;
    if (typeof record.code === "number") return record.code;
    const errorField = record.error;
    if (typeof errorField === "object" && errorField !== null) {
      const nested = errorField as Record<string, unknown>;
      if (typeof nested.code === "number") return nested.code;
      if (typeof nested.status === "number") return nested.status;
    }
  }
  return undefined;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Transient quota / rate-limit failures that should trigger a cooldown.
 * Does NOT include generic timeouts or 5xx (those stay recoverable without cooldown).
 */
export function isCooldownTriggerError(error: unknown): boolean {
  const status = extractErrorStatus(error);
  if (status === 429) return true;

  const message = errorMessage(error).toLowerCase();
  return /quota|rate.?limit|resource.?exhausted/.test(message);
}

export function classifyCooldownReason(error: unknown): CooldownReason {
  const message = errorMessage(error).toLowerCase();
  if (/quota/.test(message)) return "quota exhausted";
  if (/resource.?exhausted/.test(message)) return "resource exhausted";
  if (/rate.?limit/.test(message) || extractErrorStatus(error) === 429) {
    return "rate limited";
  }
  return "rate limited";
}

/** Redact obvious secrets before any log line that includes an error snippet. */
export function sanitizeForLog(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /(?:api[_-]?key|x-api-key|authorization)\s*[=:]\s*["']?[^\s"',}]+/gi,
      (match) => match.replace(/([=:{]\s*["']?).+$/i, "$1[redacted]"),
    )
    .replace(/AIza[0-9A-Za-z\-_]{10,}/g, "[redacted]")
    .replace(/sk-[0-9A-Za-z]{10,}/g, "[redacted]")
    .slice(0, 240);
}
