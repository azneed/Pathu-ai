import { describe, expect, it, vi } from "vitest";
import {
  isRecoverableProviderError,
  ProviderError,
  ProviderRouter,
} from "../src/ai/router.js";
import type { LLMChatInput, LLMChatResult, LLMProvider } from "../src/ai/types.js";

class MockProvider implements LLMProvider {
  readonly chat = vi.fn<(input: LLMChatInput) => Promise<LLMChatResult>>();
}

const input: LLMChatInput = {
  messages: [{ role: "user", content: "hi" }],
  tools: [],
};

describe("ProviderRouter", () => {
  it("returns primary result and does not call fallback", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    primary.chat.mockResolvedValue({
      provider: "gemini",
      assistantMessage: { role: "assistant", content: "ok" },
    });

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "ollama", provider: fallback },
    );

    const result = await router.chat(input);
    expect(result.assistantMessage.content).toBe("ok");
    expect(result.provider).toBe("gemini");
    expect(fallback.chat).not.toHaveBeenCalled();
  });

  it("falls back on Gemini quota/rate-limit failure", async () => {
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
      provider: "ollama",
      assistantMessage: { role: "assistant", content: "from ollama" },
    });

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "ollama", provider: fallback },
    );

    const result = await router.chat(input);
    expect(result.provider).toBe("ollama");
    expect(result.assistantMessage.content).toBe("from ollama");
    expect(fallback.chat).toHaveBeenCalledOnce();
  });

  it("falls back on timeout", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    primary.chat.mockRejectedValue(new Error("request timed out"));
    fallback.chat.mockResolvedValue({
      assistantMessage: { role: "assistant", content: "fallback ok" },
    });

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "ollama", provider: fallback },
    );

    const result = await router.chat(input);
    expect(result.provider).toBe("ollama");
    expect(result.assistantMessage.content).toBe("fallback ok");
  });

  it("preserves tool-call results from a successful primary", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    primary.chat.mockResolvedValue({
      provider: "gemini",
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
      { name: "ollama", provider: fallback },
    );

    const result = await router.chat(input);
    expect(result.assistantMessage.toolCalls?.[0]?.name).toBe("set_ac");
    expect(fallback.chat).not.toHaveBeenCalled();
  });

  it("uses Ollama when Gemini fails and Ollama succeeds", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    primary.chat.mockRejectedValue(
      new ProviderError("503 unavailable", {
        recoverable: true,
        status: 503,
        provider: "gemini",
      }),
    );
    fallback.chat.mockResolvedValue({
      assistantMessage: { role: "assistant", content: "ollama reply" },
    });

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "ollama", provider: fallback },
    );

    await expect(router.chat(input)).resolves.toMatchObject({
      provider: "ollama",
      assistantMessage: { content: "ollama reply" },
    });
  });

  it("surfaces a clear error when both providers fail", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    primary.chat.mockRejectedValue(
      new ProviderError("quota exceeded", {
        recoverable: true,
        provider: "gemini",
      }),
    );
    fallback.chat.mockRejectedValue(
      new ProviderError("connection refused", {
        recoverable: true,
        provider: "ollama",
      }),
    );

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "ollama", provider: fallback },
    );

    await expect(router.chat(input)).rejects.toThrow(
      /Primary \(gemini\) and fallback \(ollama\) failed/,
    );
  });

  it("does not fall back for non-recoverable programming/schema errors", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    primary.chat.mockRejectedValue(
      new ProviderError("invalid argument: malformed schema", {
        recoverable: false,
        status: 400,
        provider: "gemini",
      }),
    );

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "ollama", provider: fallback },
    );

    await expect(router.chat(input)).rejects.toThrow(/malformed schema/);
    expect(fallback.chat).not.toHaveBeenCalled();
  });

  it("classifies quota and network errors as recoverable", () => {
    expect(
      isRecoverableProviderError(new Error("RESOURCE_EXHAUSTED: quota")),
    ).toBe(true);
    expect(isRecoverableProviderError(new Error("fetch failed"))).toBe(true);
    expect(
      isRecoverableProviderError(
        new ProviderError("bad schema", { recoverable: false, status: 400 }),
      ),
    ).toBe(false);
  });
});
