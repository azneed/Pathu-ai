export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Gemini 3+ opaque signature required when replaying functionCall parts. */
  thoughtSignature?: string;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      toolCalls?: ToolCall[];
    }
  | {
      role: "tool";
      toolCallId: string;
      toolName?: string;
      content: string;
    };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMChatInput {
  messages: ChatMessage[];
  tools: ToolDefinition[];
}

export interface LLMChatResult {
  assistantMessage: Extract<ChatMessage, { role: "assistant" }>;
  /** Which concrete provider produced this result (set by providers/router). */
  provider?: string;
  /** Upstream model id when the provider reports one (e.g. OpenRouter free router). */
  model?: string;
}

export interface LLMProvider {
  chat(input: LLMChatInput): Promise<LLMChatResult>;
}
