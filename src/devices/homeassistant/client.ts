import { z } from "zod";

export class HomeAssistantError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HomeAssistantError";
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

export const haStatesListSchema = z.array(haEntityStateSchema);

export const haServiceResponseSchema = z.array(haEntityStateSchema).optional();

export interface HomeAssistantClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  maxGetRetries?: number;
  fetchImpl?: typeof fetch;
}

export class HomeAssistantClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxGetRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HomeAssistantClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token.trim();
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxGetRetries = options.maxGetRetries ?? 2;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * GET request with timeout, Zod response parsing, and retry logic.
   */
  async get<T>(path: string, schema: z.ZodSchema<T>): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts <= this.maxGetRetries) {
      attempts += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: this.headers,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!response.ok) {
          const bodyText = await response.text().catch(() => "");
          throw new HomeAssistantError(
            `Home Assistant GET ${path} failed with status ${response.status}: ${bodyText}`,
            response.status,
            bodyText,
          );
        }

        const data: unknown = await response.json();
        const parsed = schema.safeParse(data);
        if (!parsed.success) {
          throw new HomeAssistantError(
            `Home Assistant API response validation failed for ${path}: ${parsed.error.message}`,
            response.status,
            parsed.error,
          );
        }
        return parsed.data;
      } catch (err) {
        clearTimeout(timer);
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error;

        // Do not retry client 4xx errors
        if (error instanceof HomeAssistantError && error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
          throw error;
        }

        if (attempts > this.maxGetRetries) {
          break;
        }
        // Small backoff before retrying GET
        await new Promise((res) => setTimeout(res, 200 * attempts));
      }
    }

    throw lastError ?? new HomeAssistantError(`Home Assistant GET ${path} failed`);
  }

  /**
   * POST request (service calls) with timeout and Zod parsing. NO automatic retries for POST.
   */
  async post<T>(
    path: string,
    body: Record<string, unknown>,
    schema?: z.ZodSchema<T>,
  ): Promise<T | void> {
    const url = `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new HomeAssistantError(
          `Home Assistant POST ${path} failed with status ${response.status}: ${bodyText}`,
          response.status,
          bodyText,
        );
      }

      const rawText = await response.text().catch(() => "");
      if (!rawText || !schema) {
        return;
      }

      const data: unknown = JSON.parse(rawText);
      const parsed = schema.safeParse(data);
      if (!parsed.success) {
        throw new HomeAssistantError(
          `Home Assistant API response validation failed for POST ${path}: ${parsed.error.message}`,
          response.status,
          parsed.error,
        );
      }
      return parsed.data;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof HomeAssistantError) {
        throw err;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      throw new HomeAssistantError(`Home Assistant POST ${path} failed: ${error.message}`);
    }
  }

  /**
   * Fetch state of a specific entity.
   */
  async getEntityState(entityId: string): Promise<HaEntityState> {
    return this.get(`/api/states/${entityId}`, haEntityStateSchema);
  }

  /**
   * Fetch state of all entities.
   */
  async getAllStates(): Promise<HaEntityState[]> {
    return this.get("/api/states", haStatesListSchema);
  }

  /**
   * Call a service in Home Assistant (e.g. domain="climate", service="set_temperature").
   */
  async callService(
    domain: string,
    service: string,
    serviceData: Record<string, unknown>,
  ): Promise<HaEntityState[] | void> {
    return this.post(
      `/api/services/${domain}/${service}`,
      serviceData,
      haServiceResponseSchema,
    );
  }
}
