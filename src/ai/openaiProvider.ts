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

function toOpenAiMessages(
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
    throw new Error("Tool arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey: apiKey || "missing" });
  }

  async chat(input: LLMChatInput): Promise<LLMChatResult> {
    if (!this.apiKey) {
      throw new ProviderError("OPENAI_API_KEY is not set", {
        recoverable: true,
        provider: "openai",
        status: 401,
      });
    }

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: toOpenAiMessages(input.messages),
        ...(input.tools.length > 0
          ? { tools: toOpenAiTools(input.tools), tool_choice: "auto" as const }
          : {}),
      });

      const choice = completion.choices[0]?.message;
      if (!choice) {
        throw new ProviderError("OpenAI returned no assistant message", {
          recoverable: true,
          provider: "openai",
        });
      }

      const toolCalls: ToolCall[] | undefined = choice.tool_calls?.map((call) => {
        if (call.type !== "function") {
          throw new ProviderError(`Unsupported tool call type: ${call.type}`, {
            recoverable: false,
            provider: "openai",
          });
        }
        return {
          id: call.id,
          name: call.function.name,
          arguments: parseToolArguments(call.function.arguments),
        };
      });

      return {
        provider: "openai",
        assistantMessage: {
          role: "assistant",
          content: choice.content,
          toolCalls:
            toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
        },
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
          /quota|rate.?limit|timeout|network|api.?key/i.test(message),
        status,
        provider: "openai",
        cause: error,
      });
    }
  }
}
