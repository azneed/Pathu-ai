import { describe, expect, it, vi } from "vitest";
import {
  fromOpenRouterMessage,
  OpenRouterProvider,
  toOpenRouterMessages,
} from "../src/ai/openRouterProvider.js";
import { ProviderError, ProviderRouter } from "../src/ai/router.js";
import { toolDefinitions } from "../src/ai/tools.js";
import type { LLMChatInput, LLMChatResult, LLMProvider } from "../src/ai/types.js";

describe("OpenRouterProvider", () => {
  it("converts Andru messages including tool results", () => {
    const messages = toOpenRouterMessages([
      { role: "system", content: "sys" },
      { role: "user", content: "set ac" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          { id: "t1", name: "set_ac", arguments: { temperature: 22 } },
        ],
      },
      {
        role: "tool",
        toolCallId: "t1",
        toolName: "set_ac",
        content: JSON.stringify({ temperature: 22 }),
      },
    ]);

    expect(messages[2]).toMatchObject({
      role: "assistant",
      tool_calls: [
        {
          id: "t1",
          function: {
            name: "set_ac",
            arguments: JSON.stringify({ temperature: 22 }),
          },
        },
      ],
    });
    expect(messages[3]).toMatchObject({
      role: "tool",
      tool_call_id: "t1",
    });
  });

  it("maps a normal text response", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: "Hello from OpenRouter",
          },
        },
      ],
    });

    const provider = new OpenRouterProvider({
      apiKey: "test-key",
      model: "openrouter/free",
      client: {
        chat: { completions: { create } },
      } as never,
    });

    const result = await provider.chat({
      messages: [{ role: "user", content: "hi" }],
      tools: toolDefinitions,
    });

    expect(result.provider).toBe("openrouter");
    expect(result.assistantMessage.content).toBe("Hello from OpenRouter");
    expect(create).toHaveBeenCalledOnce();
  });

  it("maps tool calls from OpenRouter payloads", () => {
    const result = fromOpenRouterMessage({
      content: null,
      tool_calls: [
        {
          id: "or1",
          type: "function",
          function: {
            name: "set_ac",
            arguments: JSON.stringify({ power: "on", temperature: 22 }),
          },
        },
      ],
    });

    expect(result.assistantMessage.toolCalls).toEqual([
      {
        id: "or1",
        name: "set_ac",
        arguments: { power: "on", temperature: 22 },
      },
    ]);
  });

  it("maps tool result messages back into OpenAI-compatible tool role", () => {
    const messages = toOpenRouterMessages([
      {
        role: "tool",
        toolCallId: "or1",
        toolName: "get_devices",
        content: JSON.stringify({ "bedroom.ac": { power: "off" } }),
      },
    ]);
    expect(messages[0]).toEqual({
      role: "tool",
      tool_call_id: "or1",
      content: JSON.stringify({ "bedroom.ac": { power: "off" } }),
    });
  });

  it("marks API failures as recoverable provider errors", async () => {
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error("OpenRouter unavailable"), { status: 503 }),
    );

    const provider = new OpenRouterProvider({
      apiKey: "test-key",
      model: "openrouter/free",
      client: {
        chat: { completions: { create } },
      } as never,
    });

    await expect(
      provider.chat({
        messages: [{ role: "user", content: "hi" }],
        tools: toolDefinitions,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProviderError &&
        error.recoverable &&
        error.provider === "openrouter" &&
        error.status === 503,
    );
  });
});

class MockProvider implements LLMProvider {
  readonly chat = vi.fn<(input: LLMChatInput) => Promise<LLMChatResult>>();
}

const input: LLMChatInput = {
  messages: [{ role: "user", content: "hi" }],
  tools: [],
};

describe("ProviderRouter with OpenRouter fallback", () => {
  it("returns Gemini success without calling OpenRouter", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    primary.chat.mockResolvedValue({
      provider: "gemini",
      assistantMessage: { role: "assistant", content: "ok" },
    });

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "openrouter", provider: fallback },
    );

    const result = await router.chat(input);
    expect(result.provider).toBe("gemini");
    expect(fallback.chat).not.toHaveBeenCalled();
  });

  it("falls back to OpenRouter on Gemini quota failure", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    primary.chat.mockRejectedValue(
      new ProviderError("quota exceeded", {
        recoverable: true,
        status: 429,
        provider: "gemini",
      }),
    );
    fallback.chat.mockResolvedValue({
      provider: "openrouter",
      assistantMessage: {
        role: "assistant",
        content: null,
        toolCalls: [
          {
            id: "1",
            name: "set_ac",
            arguments: { temperature: 22 },
          },
        ],
      },
    });

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "openrouter", provider: fallback },
    );

    const result = await router.chat(input);
    expect(result.provider).toBe("openrouter");
    expect(result.assistantMessage.toolCalls?.[0]?.name).toBe("set_ac");
    expect(fallback.chat).toHaveBeenCalledOnce();
  });

  it("surfaces a clear error when Gemini and OpenRouter both fail", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    primary.chat.mockRejectedValue(
      new ProviderError("quota exceeded", {
        recoverable: true,
        provider: "gemini",
      }),
    );
    fallback.chat.mockRejectedValue(
      new ProviderError("openrouter down", {
        recoverable: true,
        provider: "openrouter",
      }),
    );

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "openrouter", provider: fallback },
    );

    await expect(router.chat(input)).rejects.toThrow(
      /Primary \(gemini\) and fallback \(openrouter\) failed/,
    );
  });
});
