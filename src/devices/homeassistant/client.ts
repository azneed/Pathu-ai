import { z } from "zod";

export type HomeAssistantErrorKind =
  | "http"
  | "timeout"
  | "network"
  | "invalid_json"
  | "invalid_response"
  | "invalid_request";

/** Internal-only context for debugging. Never part of `message`, never enumerable. */
export interface HomeAssistantDiagnostics {
  method: "GET" | "POST";
  path: string;
  /** First characters of an error response body. */
  responseSnippet?: string;
  /** Message of the underlying fetch / parse error. */
  cause?: string;
}

const RESPONSE_SNIPPET_LENGTH = 200;

function safeMessage(kind: HomeAssistantErrorKind, statusCode?: number): string {
  switch (kind) {
    case "http":
      if (statusCode === 401 || statusCode === 403) {
        return `Home Assistant rejected the access token (HTTP ${statusCode})`;
      }
      if (statusCode === 404) {
        return "Home Assistant does not know the configured device (HTTP 404)";
      }
      return `Home Assistant request failed (HTTP ${statusCode ?? "error"})`;
    case "timeout":
      return "Home Assistant did not respond in time";
    case "network":
      return "Home Assistant is unreachable";
    case "invalid_json":
    case "invalid_response":
      return "Home Assistant returned an unexpected response";
    case "invalid_request":
      return "Home Assistant request was rejected before sending";
  }
}

/**
 * Error with a message that is safe to show to users and the LLM: no URL, entity ID, token or
 * response body. Debug context lives in the non-enumerable `diagnostics` property.
 */
export class HomeAssistantError extends Error {
  readonly kind: HomeAssistantErrorKind;
  readonly statusCode?: number;
  declare readonly diagnostics: HomeAssistantDiagnostics;

  constructor(
    kind: HomeAssistantErrorKind,
    diagnostics: HomeAssistantDiagnostics,
    statusCode?: number,
  ) {
    super(safeMessage(kind, statusCode));
    this.name = "HomeAssistantError";
    this.kind = kind;
    if (statusCode !== undefined) this.statusCode = statusCode;
    Object.defineProperty(this, "diagnostics", {
      value: diagnostics,
      enumerable: false,
    });
  }

  /** Transient failures worth one more GET attempt. */
  get retryable(): boolean {
    return (
      this.kind === "timeout" ||
      this.kind === "network" ||
      (this.kind === "http" && this.statusCode !== undefined && this.statusCode >= 500)
    );
  }
}

export const haEntityStateSchema = z.object({
  entity_id: z.string(),
  state: z.string(),
  attributes: z.record(z.unknown()).default({}),
  last_changed: z.string().optional(),
  last_updated: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

export type HaEntityState = z.infer<typeof haEntityStateSchema>;

/** Bulk /api/states is only checked for shape; mapped entities are validated individually. */
const haStatesListSchema = z.array(z.object({ entity_id: z.string() }).passthrough());

const SERVICE_PART = /^[a-z][a-z0-9_]*$/;

export interface HomeAssistantClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  /** Extra attempts for idempotent GETs after a transient failure. POST is never retried. */
  maxGetRetries?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export class HomeAssistantClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxGetRetries: number;
  private readonly retryDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HomeAssistantClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token.trim();
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxGetRetries = options.maxGetRetries ?? 1;
    this.retryDelayMs = options.retryDelayMs ?? 250;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /** GET + JSON + schema validation. Only transient failures are retried. */
  async get<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
    const diagnostics: HomeAssistantDiagnostics = { method: "GET", path };
    for (let attempt = 0; ; attempt += 1) {
      try {
        const text = await this.request("GET", path, undefined);
        return this.parse(text, schema, diagnostics);
      } catch (error) {
        const retry =
          error instanceof HomeAssistantError && error.retryable && attempt < this.maxGetRetries;
        if (!retry) throw error;
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * (attempt + 1)));
      }
    }
  }

  /** Service-call POST. Never retried automatically: a retry could repeat a device action. */
  async post(path: string, body: Record<string, unknown>): Promise<void> {
    await this.request("POST", path, body);
  }

  async getEntityState(entityId: string): Promise<HaEntityState> {
    return this.get(`/api/states/${encodeURIComponent(entityId)}`, haEntityStateSchema);
  }

  /** One bulk read; returns the valid states of the requested entities that exist. */
  async getEntityStates(entityIds: readonly string[]): Promise<Map<string, HaEntityState>> {
    const wanted = new Set(entityIds);
    const all = await this.get("/api/states", haStatesListSchema);
    const states = new Map<string, HaEntityState>();
    for (const raw of all) {
      if (!wanted.has(raw.entity_id)) continue;
      const parsed = haEntityStateSchema.safeParse(raw);
      if (parsed.success) states.set(raw.entity_id, parsed.data);
    }
    return states;
  }

  async callService(
    domain: string,
    service: string,
    serviceData: Record<string, unknown>,
  ): Promise<void> {
    if (!SERVICE_PART.test(domain) || !SERVICE_PART.test(service)) {
      throw new HomeAssistantError("invalid_request", {
        method: "POST",
        path: "/api/services/<invalid>",
      });
    }
    await this.post(`/api/services/${domain}/${service}`, serviceData);
  }

  private parse<T>(
    text: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    diagnostics: HomeAssistantDiagnostics,
  ): T {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new HomeAssistantError("invalid_json", {
        ...diagnostics,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new HomeAssistantError("invalid_response", {
        ...diagnostics,
        cause: parsed.error.message,
      });
    }
    return parsed.data;
  }

  /** One HTTP exchange, including reading the body, bounded by `timeoutMs`. Returns the body text. */
  private async request(
    method: "GET" | "POST",
    path: string,
    body: Record<string, unknown> | undefined,
  ): Promise<string> {
    const diagnostics: HomeAssistantDiagnostics = { method, path };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new HomeAssistantError("timeout", diagnostics));
      }, this.timeoutMs);
    });

    const exchange = async (): Promise<string> => {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        throw new HomeAssistantError(controller.signal.aborted ? "timeout" : "network", {
          ...diagnostics,
          cause: error instanceof Error ? error.message : String(error),
        });
      }

      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        throw new HomeAssistantError(controller.signal.aborted ? "timeout" : "network", {
          ...diagnostics,
          cause: error instanceof Error ? error.message : String(error),
        });
      }

      if (!response.ok) {
        throw new HomeAssistantError(
          "http",
          { ...diagnostics, responseSnippet: text.slice(0, RESPONSE_SNIPPET_LENGTH) },
          response.status,
        );
      }
      return text;
    };

    try {
      return await Promise.race([exchange(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
