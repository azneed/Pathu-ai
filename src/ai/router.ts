import {
  classifyCooldownReason,
  errorMessage,
  extractErrorStatus,
  isCooldownTriggerError,
  ProviderCooldownRegistry,
  sanitizeForLog,
} from "./providerCooldown.js";
import type { LLMChatInput, LLMChatResult, LLMProvider } from "./types.js";

export type ProviderName = "gemini" | "ollama" | "openai" | "openrouter";

export interface NamedLLMProvider {
  name: ProviderName;
  provider: LLMProvider;
}

export class ProviderError extends Error {
  readonly recoverable: boolean;
  readonly status?: number;
  readonly provider?: string;

  constructor(
    message: string,
    options: {
      recoverable: boolean;
      status?: number;
      provider?: string;
      cause?: unknown;
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ProviderError";
    this.recoverable = options.recoverable;
    this.status = options.status;
    this.provider = options.provider;
  }
}

function extractStatus(error: unknown): number | undefined {
  if (error instanceof ProviderError && error.status !== undefined) {
    return error.status;
  }
  return extractErrorStatus(error);
}

function errorText(error: unknown): string {
  return errorMessage(error);
}

/**
 * Recoverable = safe to try an independently configured fallback provider.
 * Auth/quota/network/5xx are recoverable when another provider exists.
 * Malformed requests / schema / programming bugs are not.
 */
export function isRecoverableProviderError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.recoverable;
  }

  const status = extractStatus(error);
  const message = errorText(error).toLowerCase();

  if (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 529
  ) {
    return true;
  }

  // Primary auth/config failure can still fall back to a different provider.
  if (status === 401 || status === 403) {
    return true;
  }

  if (
    /quota|rate.?limit|resource.?exhausted|unavailable|overloaded|timeout|timed out|econnrefused|enotfound|econnreset|fetch failed|network|socket|502|503|504|429/.test(
      message,
    )
  ) {
    return true;
  }

  if (
    /api.?key|unauthorized|forbidden|invalid.?key|missing .+ api key|not set/.test(
      message,
    )
  ) {
    return true;
  }

  // Explicit non-recoverable signals
  if (status === 400) return false;
  if (
    /invalid.?argument|malformed|unsupported tool|programming error|zod|schema validation/.test(
      message,
    )
  ) {
    return false;
  }

  return false;
}

export interface ProviderRouterOptions {
  /** Seconds to skip a provider after 429/quota/rate-limit (default 300). */
  cooldownSeconds?: number;
  /** Shared or test-injected cooldown registry. */
  cooldown?: ProviderCooldownRegistry;
  now?: () => Date;
}

export class ProviderRouter implements LLMProvider {
  private readonly cooldownSeconds: number;
  private readonly cooldown: ProviderCooldownRegistry;
  private readonly now: () => Date;

  constructor(
    private readonly primary: NamedLLMProvider,
    private readonly fallback?: NamedLLMProvider,
    options: ProviderRouterOptions = {},
  ) {
    this.cooldownSeconds = options.cooldownSeconds ?? 300;
    this.cooldown = options.cooldown ?? new ProviderCooldownRegistry();
    this.now = options.now ?? (() => new Date());
  }

  /** Test/helper access to cooldown state. */
  getCooldownRegistry(): ProviderCooldownRegistry {
    return this.cooldown;
  }

  async chat(input: LLMChatInput): Promise<LLMChatResult> {
    const configured: NamedLLMProvider[] = this.fallback
      ? [this.primary, this.fallback]
      : [this.primary];

    const nowMs = this.now().getTime();
    if (
      configured.every((entry) => !this.cooldown.isAvailable(entry.name, nowMs))
    ) {
      throw this.allUnavailableError(configured, nowMs);
    }

    let primaryMessage = "";

    if (this.cooldown.isAvailable(this.primary.name, nowMs)) {
      console.log(`LLM primary provider: ${this.primary.name}`);
      try {
        const result = await this.primary.provider.chat(input);
        this.cooldown.clear(this.primary.name);
        return {
          ...result,
          provider: result.provider ?? this.primary.name,
          model: result.model,
        };
      } catch (primaryError) {
        primaryMessage = errorText(primaryError);
        this.maybeEnterCooldown(this.primary.name, primaryError);

        if (!this.fallback || !isRecoverableProviderError(primaryError)) {
          throw primaryError instanceof ProviderError
            ? primaryError
            : new ProviderError(primaryMessage, {
                recoverable: false,
                provider: this.primary.name,
                cause: primaryError,
                status: extractStatus(primaryError),
              });
        }
      }
    } else {
      console.log(
        `[AI] Skipping ${displayName(this.primary.name)}: provider cooldown active`,
      );
      primaryMessage = `${displayName(this.primary.name)} in cooldown`;
      if (!this.fallback) {
        throw this.allUnavailableError(configured, this.now().getTime());
      }
    }

    // Fallback path
    const fallback = this.fallback!;
    const fallbackNow = this.now().getTime();
    if (!this.cooldown.isAvailable(fallback.name, fallbackNow)) {
      console.log(
        `[AI] Skipping ${displayName(fallback.name)}: provider cooldown active`,
      );
      throw this.allUnavailableError(configured, fallbackNow);
    }

    console.log(`[AI] Falling back to ${displayName(fallback.name)}`);
    console.log(`LLM fallback provider: ${fallback.name}`);

    try {
      const result = await fallback.provider.chat(input);
      this.cooldown.clear(fallback.name);
      return {
        ...result,
        provider: result.provider ?? fallback.name,
        model: result.model,
      };
    } catch (fallbackError) {
      const fallbackMessage = errorText(fallbackError);
      this.maybeEnterCooldown(fallback.name, fallbackError);
      throw new ProviderError(
        `Primary (${this.primary.name}) and fallback (${fallback.name}) failed. Primary: ${sanitizeForLog(primaryMessage)}; Fallback: ${sanitizeForLog(fallbackMessage)}`,
        {
          recoverable: false,
          provider: fallback.name,
          cause: fallbackError,
          status: extractStatus(fallbackError),
        },
      );
    }
  }

  private maybeEnterCooldown(provider: ProviderName, error: unknown): void {
    if (!isCooldownTriggerError(error)) return;
    const reason = classifyCooldownReason(error);
    this.cooldown.markUnavailable(
      provider,
      this.cooldownSeconds,
      reason,
      this.now().getTime(),
    );
    console.warn(
      `[AI] ${displayName(provider)} unavailable for ${this.cooldownSeconds}s: ${reason}`,
    );
  }

  private allUnavailableError(
    configured: NamedLLMProvider[],
    nowMs: number,
  ): ProviderError {
    const details = configured
      .map((entry) => {
        const remaining = this.cooldown.remainingSeconds(entry.name, nowMs);
        const state = this.cooldown.get(entry.name);
        const reason = state?.reason ?? "cooldown";
        return `${displayName(entry.name)} (${reason}, ${remaining}s left)`;
      })
      .join("; ");
    return new ProviderError(
      `All AI providers are temporarily unavailable due to rate limits/quota. ${details}. Try again shortly.`,
      { recoverable: false, provider: this.primary.name },
    );
  }
}

function displayName(name: ProviderName): string {
  switch (name) {
    case "gemini":
      return "Gemini";
    case "openrouter":
      return "OpenRouter";
    case "ollama":
      return "Ollama";
    case "openai":
      return "OpenAI";
    default: {
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}
