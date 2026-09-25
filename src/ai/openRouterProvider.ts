import OpenAI from "openai";
import { ProviderError } from "./router.js";
import type {
  ChatMessage,
  LLMChatInput,
  LLMChatResult,
  LLMProvider,
  ToolCall,
  ToolDefinition,
} from "./types.js";

export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_DEFAULT_MODEL = "openrouter/free";

function toOpenAiTools(tools: ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function toOpenRouterMessages(
  messages: ChatMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
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
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }

    if (message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
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

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw || raw.trim() === "") {
    return {};
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ProviderError("OpenRouter tool arguments must be a JSON object", {
      recoverable: false,
      provider: "openrouter",
    });
  }
  return parsed as Record<string, unknown>;
}

export function fromOpenRouterMessage(choice: {
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}): LLMChatResult {
  const toolCalls: ToolCall[] | undefined = choice.tool_calls?.map((call) => {
    if (call.type !== "function") {
      throw new ProviderError(`Unsupported tool call type: ${call.type}`, {
        recoverable: false,
        provider: "openrouter",
      });
    }
    return {
      id: call.id,
      name: call.function.name,
      arguments: parseToolArguments(call.function.arguments),
    };
  });

  return {
    provider: "openrouter",
    assistantMessage: {
      role: "assistant",
      content: choice.content ?? null,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    },
  };
}

export class OpenRouterProvider implements LLMProvider {
  private readonly client: OpenAI;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: {
    apiKey: string;
    model: string;
    baseUrl?: string;
    client?: OpenAI;
  }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey || "missing",
        baseURL: options.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL,
        defaultHeaders: {
          "HTTP-Referer": "http://127.0.0.1:3001",
          "X-Title": "Pathu",
        },
      });
  }

  async chat(input: LLMChatInput): Promise<LLMChatResult> {
    if (!this.apiKey) {
      throw new ProviderError("OPENROUTER_API_KEY is not set", {
        recoverable: true,
        provider: "openrouter",
        status: 401,
      });
    }

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: toOpenRouterMessages(input.messages),
        tools: toOpenAiTools(input.tools),
        tool_choice: "auto",
      });

      const choice = completion.choices[0]?.message;
      if (!choice) {
        throw new ProviderError("OpenRouter returned no assistant message", {
          recoverable: true,
          provider: "openrouter",
        });
      }

      return {
        ...fromOpenRouterMessage(choice),
        model: completion.model,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const status =
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        typeof (error as { status: unknown }).status === "number"
          ? (error as { status: number }).status
          : undefined;
      throw new ProviderError(message, {
        recoverable:
          status === 429 ||
          status === 500 ||
          status === 502 ||
          status === 503 ||
          status === 401 ||
          status === 403 ||
          /quota|rate.?limit|timeout|network|api.?key|unavailable/i.test(message),
        status,
        provider: "openrouter",
        cause: error,
      });
    }
  }
}
