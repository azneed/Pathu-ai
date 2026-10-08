import { ProviderError } from "./router.js";
import type {
  ChatMessage,
  LLMChatInput,
  LLMChatResult,
  LLMProvider,
  ToolCall,
  ToolDefinition,
} from "./types.js";

export type OllamaFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

interface OllamaToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
}

interface OllamaChatResponse {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
  error?: string;
}

function toOllamaTools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function toOllamaMessages(
  messages: ChatMessage[],
): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.role === "system") {
      return { role: "system", content: message.content };
    }
    if (message.role === "user") {
      return { role: "user", content: message.content };
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        content: message.content,
        tool_name: message.toolName,
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      };
    }

    if (message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: message.content ?? "",
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: call.arguments,
          },
        })),
      };
    }

    return {
      role: "assistant",
      content: message.content ?? "",
    };
  });
}

function parseArgs(
  args: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (args == null) return {};
  if (typeof args === "object") return args;
  if (!args.trim()) return {};
  const parsed: unknown = JSON.parse(args);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ProviderError("Ollama tool arguments must be a JSON object", {
      recoverable: false,
      provider: "ollama",
    });
  }
  return parsed as Record<string, unknown>;
}

export function fromOllamaResponse(payload: OllamaChatResponse): LLMChatResult {
  if (payload.error) {
    throw new ProviderError(payload.error, {
      recoverable: true,
      provider: "ollama",
    });
  }

  const message = payload.message;
  if (!message) {
    throw new ProviderError("Ollama returned no assistant message", {
      recoverable: true,
      provider: "ollama",
    });
  }

  const toolCalls: ToolCall[] | undefined = message.tool_calls?.map(
    (call, index) => {
      if (!call.function?.name) {
        throw new ProviderError("Ollama tool call missing function name", {
          recoverable: false,
          provider: "ollama",
        });
      }
      return {
        id: call.id ?? `ollama_call_${index}`,
        name: call.function.name,
        arguments: parseArgs(call.function.arguments),
      };
    },
  );

  return {
    provider: "ollama",
    assistantMessage: {
      role: "assistant",
      content: message.content ?? null,
      toolCalls:
        toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    },
  };
}

function classifyOllamaError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const recoverable =
    /econnrefused|enotfound|timeout|timed out|fetch failed|network|socket|unavailable|overloaded|429|502|503|504/.test(
      lower,
    );
  return new ProviderError(message, {
    recoverable,
    provider: "ollama",
    cause: error,
  });
}

export class OllamaProvider implements LLMProvider {
  constructor(
    private readonly options: {
      baseUrl: string;
      model: string;
      fetchImpl?: OllamaFetch;
      timeoutMs?: number;
    },
  ) {}

  async chat(input: LLMChatInput): Promise<LLMChatResult> {
    if (!this.options.model) {
      throw new ProviderError("OLLAMA_MODEL is not set", {
        recoverable: false,
        provider: "ollama",
      });
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/api/chat`;
    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.options.model,
          messages: toOllamaMessages(input.messages),
          ...(input.tools.length > 0 ? { tools: toOllamaTools(input.tools) } : {}),
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ProviderError(
          `Ollama HTTP ${response.status}${body ? `: ${body}` : ""}`,
          {
            recoverable:
              response.status === 429 ||
              response.status >= 500 ||
              response.status === 404,
            status: response.status,
            provider: "ollama",
          },
        );
      }

      const payload = (await response.json()) as OllamaChatResponse;
      return fromOllamaResponse(payload);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderError("Ollama request timed out", {
          recoverable: true,
          provider: "ollama",
        });
      }
      throw classifyOllamaError(error);
    } finally {
      clearTimeout(timer);
    }
  }
}
