import { GoogleGenAI } from "@google/genai";
import {
  extractCauseMessage,
  extractErrorStatus,
  sanitizeForLog,
} from "./providerCooldown.js";
import { ProviderError } from "./router.js";
import type {
  ChatMessage,
  LLMChatInput,
  LLMChatResult,
  LLMProvider,
  ToolCall,
  ToolDefinition,
} from "./types.js";

export type GeminiGenerateContent = (params: {
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
}) => Promise<{
  text?: string;
  functionCalls?: Array<{
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  }>;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        thoughtSignature?: string;
        functionCall?: {
          id?: string;
          name?: string;
          args?: Record<string, unknown>;
        };
      }>;
    };
  }>;
}>;

export interface GeminiClientLike {
  models: {
    generateContent: GeminiGenerateContent;
  };
}

function toGeminiTools(tools: ToolDefinition[]) {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.parameters,
      })),
    },
  ];
}

function parseToolArgs(args: unknown): Record<string, unknown> {
  if (args == null) return {};
  if (typeof args === "string") {
    if (!args.trim()) return {};
    const parsed: unknown = JSON.parse(args);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ProviderError("Gemini tool arguments must be a JSON object", {
        recoverable: false,
        provider: "gemini",
      });
    }
    return parsed as Record<string, unknown>;
  }
  if (typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  throw new ProviderError("Gemini tool arguments must be a JSON object", {
    recoverable: false,
    provider: "gemini",
  });
}

/** Convert Pathu messages into Gemini contents + system instruction. */
export function toGeminiRequest(messages: ChatMessage[]): {
  systemInstruction?: string;
  contents: Array<{ role: string; parts: unknown[] }>;
} {
  let systemInstruction: string | undefined;
  const contents: Array<{ role: string; parts: unknown[] }> = [];

  let pendingToolParts: unknown[] = [];

  const flushTools = () => {
    if (pendingToolParts.length === 0) return;
    contents.push({ role: "user", parts: pendingToolParts });
    pendingToolParts = [];
  };

  for (const message of messages) {
    if (message.role === "system") {
      systemInstruction = systemInstruction
        ? `${systemInstruction}\n${message.content}`
        : message.content;
      continue;
    }

    if (message.role === "tool") {
      let response: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(message.content);
        response =
          typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { result: parsed };
      } catch {
        response = { result: message.content };
      }

      pendingToolParts.push({
        functionResponse: {
          id: message.toolCallId,
          name: message.toolName ?? "unknown",
          response,
        },
      });
      continue;
    }

    flushTools();

    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.content }] });
      continue;
    }

    const parts: unknown[] = [];
    if (message.content) {
      parts.push({ text: message.content });
    }
    if (message.toolCalls) {
      for (const call of message.toolCalls) {
        const part: Record<string, unknown> = {
          functionCall: {
            id: call.id,
            name: call.name,
            args: call.arguments,
          },
        };
        if (call.thoughtSignature) {
          part.thoughtSignature = call.thoughtSignature;
        }
        parts.push(part);
      }
    }
    contents.push({
      role: "model",
      parts: parts.length > 0 ? parts : [{ text: "" }],
    });
  }

  flushTools();
  return { systemInstruction, contents };
}

export function fromGeminiResponse(response: {
  text?: string;
  functionCalls?: Array<{
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  }>;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        thoughtSignature?: string;
        functionCall?: {
          id?: string;
          name?: string;
          args?: Record<string, unknown>;
        };
      }>;
    };
  }>;
}): LLMChatResult {
  const toolCalls: ToolCall[] = [];
  const textParts: string[] = [];

  // Prefer raw candidate parts so Gemini thought signatures are preserved.
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  if (parts.length > 0) {
    for (const [index, part] of parts.entries()) {
      if (part.text) textParts.push(part.text);
      if (part.functionCall?.name) {
        toolCalls.push({
          id: part.functionCall.id ?? `gemini_call_${index}`,
          name: part.functionCall.name,
          arguments: parseToolArgs(part.functionCall.args),
          thoughtSignature: part.thoughtSignature,
        });
      }
    }
  } else if (response.functionCalls && response.functionCalls.length > 0) {
    for (const [index, call] of response.functionCalls.entries()) {
      if (!call.name) continue;
      toolCalls.push({
        id: call.id ?? `gemini_call_${index}`,
        name: call.name,
        arguments: parseToolArgs(call.args),
      });
    }
  }

  const content =
    textParts.length > 0
      ? textParts.join("")
      : response.text?.trim()
        ? response.text
        : null;

  return {
    provider: "gemini",
    assistantMessage: {
      role: "assistant",
      content: toolCalls.length > 0 ? content : content ?? "",
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    },
  };
}

function classifyGeminiError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  let status: number | undefined = extractErrorStatus(error);
  if (status === undefined) {
    const statusMatch = message.match(/\b([45]\d\d)\b/);
    if (statusMatch) {
      status = Number(statusMatch[1]);
    }
  }

  const recoverable =
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 401 ||
    status === 403 ||
    /quota|rate.?limit|resource.?exhausted|unavailable|timeout|network|fetch failed|api.?key|unauthorized/.test(
      lower,
    );

  const nonRecoverable =
    status === 400 ||
    /invalid.?argument|malformed|schema/.test(lower);

  return new ProviderError(message, {
    recoverable: nonRecoverable ? false : recoverable,
    status,
    provider: "gemini",
    cause: error,
  });
}

export class GeminiProvider implements LLMProvider {
  private client: GeminiClientLike | undefined;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly injectedClient?: GeminiClientLike;

  constructor(options: {
    apiKey: string;
    model: string;
    client?: GeminiClientLike;
  }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.injectedClient = options.client;
  }

  private getClient(): GeminiClientLike {
    if (this.injectedClient) return this.injectedClient;
    if (!this.client) {
      this.client = new GoogleGenAI({
        apiKey: this.apiKey,
      }) as unknown as GeminiClientLike;
    }
    return this.client;
  }

  async chat(input: LLMChatInput): Promise<LLMChatResult> {
    if (!this.apiKey) {
      throw new ProviderError("GEMINI_API_KEY is not set", {
        recoverable: true,
        provider: "gemini",
        status: 401,
      });
    }

    const { systemInstruction, contents } = toGeminiRequest(input.messages);

    try {
      const response = await this.getClient().models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction,
          tools: toGeminiTools(input.tools),
          automaticFunctionCalling: { disable: true },
        },
      });
      return fromGeminiResponse(response);
    } catch (error) {
      const providerError = classifyGeminiError(error);
      const causeMsg = extractCauseMessage(error);
      console.error(
        `[AI] Gemini provider error: ${sanitizeForLog(providerError.message)} | provider: ${providerError.provider} | status: ${providerError.status ?? "none"} | recoverable: ${providerError.recoverable}${causeMsg ? ` | cause: ${sanitizeForLog(causeMsg)}` : ""}`,
      );
      throw providerError;
    }
  }
}
