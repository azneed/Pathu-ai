/** Local UI / API types matching Pathu backend `/chat` and `/health`. */

export type MessageRole = "user" | "assistant";

export type UiMessage = {
  id: string;
  role: MessageRole;
  content: string;
};

/** POST /chat request body (routes.ts chatBodySchema). */
export type ChatRequest = {
  message: string;
};

/**
 * Successful POST /chat JSON (src/ai/chat.ts ChatResult).
 * Mobile only requires `reply` for display; other fields are preserved.
 */
export type ChatSuccessResponse = {
  reply: string;
  devices: Record<string, unknown>;
  toolTrace: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    error?: string;
  }>;
  provider?: string;
  model?: string;
  clientActions?: unknown[];
};

/** GET /health */
export type HealthResponse = {
  ok: boolean;
  name: string;
};

export type ApiErrorBody = {
  error?: string;
  details?: unknown;
};

export class PathuApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "PathuApiError";
    this.status = status;
    this.details = details;
  }
}
