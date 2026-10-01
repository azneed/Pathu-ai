import { getApiBaseUrl } from "./config";
import {
  PathuApiError,
  type ApiErrorBody,
  type ChatRequest,
  type ChatSuccessResponse,
  type HealthResponse,
} from "./types";

const DEFAULT_TIMEOUT_MS = 60_000;
const HEALTH_TIMEOUT_MS = 5_000;

async function fetchJson<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const base = getApiBaseUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers:
        options.body !== undefined
          ? { "Content-Type": "application/json", Accept: "application/json" }
          : { Accept: "application/json" },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        throw new PathuApiError(
          `Invalid JSON from ${path}`,
          response.status,
          text.slice(0, 200),
        );
      }
    }

    if (!response.ok) {
      const err = (data ?? {}) as ApiErrorBody;
      const message =
        typeof err.error === "string" && err.error.trim()
          ? err.error
          : `HTTP ${response.status}`;
      throw new PathuApiError(message, response.status, err.details);
    }

    return data as T;
  } catch (error) {
    if (error instanceof PathuApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new PathuApiError("Request timed out", 0);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PathuApiError(message, 0);
  } finally {
    clearTimeout(timer);
  }
}

export async function getHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>("/health", {
    method: "GET",
    timeoutMs: HEALTH_TIMEOUT_MS,
  });
}

export async function chat(
  request: ChatRequest,
): Promise<ChatSuccessResponse> {
  const message = request.message.trim();
  if (!message) {
    throw new PathuApiError("message is required", 400);
  }
  return fetchJson<ChatSuccessResponse>("/chat", {
    method: "POST",
    body: { message } satisfies ChatRequest,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
}

export { getApiBaseUrl, PathuApiError };
