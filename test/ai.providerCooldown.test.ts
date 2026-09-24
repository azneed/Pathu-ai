import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyCooldownReason,
  isCooldownTriggerError,
  ProviderCooldownRegistry,
  sanitizeForLog,
} from "../src/ai/providerCooldown.js";
import {
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

describe("provider cooldown helpers", () => {
  it("detects 429 / quota / rate-limit / resource exhausted as cooldown triggers", () => {
    expect(
      isCooldownTriggerError(
        new ProviderError("quota exceeded", { recoverable: true, status: 429 }),
      ),
    ).toBe(true);
    expect(
      isCooldownTriggerError(new Error("RESOURCE_EXHAUSTED: quota")),
    ).toBe(true);
    expect(isCooldownTriggerError(new Error("rate limit exceeded"))).toBe(true);
    expect(isCooldownTriggerError(new Error("request timed out"))).toBe(false);
    expect(
      isCooldownTriggerError(
        new ProviderError("503 unavailable", {
          recoverable: true,
          status: 503,
        }),
      ),
    ).toBe(false);
  });

  it("classifies cooldown reasons", () => {
    expect(classifyCooldownReason(new Error("You exceeded your current quota"))).toBe(
      "quota exhausted",
    );
    expect(classifyCooldownReason(new Error("rate limit exceeded"))).toBe(
      "rate limited",
    );
    expect(classifyCooldownReason(new Error("RESOURCE_EXHAUSTED"))).toBe(
      "resource exhausted",
    );
  });

  it("sanitizes secrets from log snippets", () => {
    const dirty =
      "failed api_key=AIzaSyFakeSecretKeyValue123 Bearer sk-abcdefghijklmnop";
    const clean = sanitizeForLog(dirty);
    expect(clean).not.toMatch(/AIzaSyFake/);
    expect(clean).not.toMatch(/sk-abcdefghijklmnop/);
    expect(clean).toMatch(/\[redacted\]/);
  });
});

describe("ProviderRouter cooldown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Gemini succeeds → no fallback and clears any prior cooldown", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    const cooldown = new ProviderCooldownRegistry();
    cooldown.markUnavailable("gemini", 300, "quota exhausted", 0);

    primary.chat.mockResolvedValue({
      provider: "gemini",
      assistantMessage: { role: "assistant", content: "ok" },
    });

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "openrouter", provider: fallback },
      { cooldown, cooldownSeconds: 300, now: () => new Date(400_000) },
    );

    const result = await router.chat(input);
    expect(result.provider).toBe("gemini");
    expect(fallback.chat).not.toHaveBeenCalled();
    expect(cooldown.isAvailable("gemini", 400_000)).toBe(true);
  });

  it("Gemini 429 → enters cooldown and OpenRouter is attempted", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    const cooldown = new ProviderCooldownRegistry();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    primary.chat.mockRejectedValue(
      new ProviderError("quota exceeded", {
        recoverable: true,
        status: 429,
        provider: "gemini",
      }),
    );
    fallback.chat.mockResolvedValue({
      provider: "openrouter",
      assistantMessage: { role: "assistant", content: "from openrouter" },
    });

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "openrouter", provider: fallback },
      { cooldown, cooldownSeconds: 300, now: () => new Date(1_000) },
    );

    const result = await router.chat(input);
    expect(result.provider).toBe("openrouter");
    expect(fallback.chat).toHaveBeenCalledOnce();
    expect(cooldown.isAvailable("gemini", 1_000)).toBe(false);
    expect(cooldown.get("gemini")?.reason).toBe("quota exhausted");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[AI] Gemini unavailable for 300s: quota exhausted"),
    );
  });

  it("Gemini in cooldown → Gemini is skipped", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    const cooldown = new ProviderCooldownRegistry();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    cooldown.markUnavailable("gemini", 300, "quota exhausted", 0);

    fallback.chat.mockResolvedValue({
      provider: "openrouter",
      assistantMessage: { role: "assistant", content: "fallback" },
    });

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "openrouter", provider: fallback },
      { cooldown, cooldownSeconds: 300, now: () => new Date(1_000) },
    );

    const result = await router.chat(input);
    expect(result.assistantMessage.content).toBe("fallback");
    expect(primary.chat).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "[AI] Skipping Gemini: provider cooldown active",
    );
  });

  it("OpenRouter 429 → OpenRouter enters cooldown", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    const cooldown = new ProviderCooldownRegistry();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    primary.chat.mockRejectedValue(
      new ProviderError("quota exceeded", {
        recoverable: true,
        status: 429,
        provider: "gemini",
      }),
    );
    fallback.chat.mockRejectedValue(
      new ProviderError("rate limit exceeded: free-models-per-day", {
        recoverable: true,
        status: 429,
        provider: "openrouter",
      }),
    );

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "openrouter", provider: fallback },
      { cooldown, cooldownSeconds: 120, now: () => new Date(1_000) },
    );

    await expect(router.chat(input)).rejects.toThrow(
      /Primary \(gemini\) and fallback \(openrouter\) failed/,
    );
    expect(cooldown.isAvailable("openrouter", 1_000)).toBe(false);
    expect(cooldown.get("openrouter")?.reason).toBe("rate limited");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "[AI] OpenRouter unavailable for 120s: rate limited",
      ),
    );
  });

  it("both providers unavailable → fail immediately without calling them", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    const cooldown = new ProviderCooldownRegistry();
    cooldown.markUnavailable("gemini", 300, "quota exhausted", 0);
    cooldown.markUnavailable("openrouter", 300, "rate limited", 0);

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "openrouter", provider: fallback },
      { cooldown, cooldownSeconds: 300, now: () => new Date(1_000) },
    );

    await expect(router.chat(input)).rejects.toThrow(
      /All AI providers are temporarily unavailable/,
    );
    expect(primary.chat).not.toHaveBeenCalled();
    expect(fallback.chat).not.toHaveBeenCalled();
  });

  it("cooldown expiry → provider becomes eligible again", async () => {
    const primary = new MockProvider();
    const cooldown = new ProviderCooldownRegistry();
    let now = 1_000;
    cooldown.markUnavailable("gemini", 300, "quota exhausted", now);

    primary.chat.mockResolvedValue({
      assistantMessage: { role: "assistant", content: "after cooldown" },
    });

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      undefined,
      {
        cooldown,
        cooldownSeconds: 300,
        now: () => new Date(now),
      },
    );

    await expect(router.chat(input)).rejects.toThrow(/temporarily unavailable/);
    expect(primary.chat).not.toHaveBeenCalled();

    now = 1_000 + 300_000;
    const result = await router.chat(input);
    expect(result.assistantMessage.content).toBe("after cooldown");
    expect(primary.chat).toHaveBeenCalledOnce();
  });

  it("successful request after cooldown clears failure state", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    const cooldown = new ProviderCooldownRegistry();
    const now = 5_000;
    cooldown.markUnavailable("gemini", 1, "quota exhausted", now - 2_000);

    primary.chat.mockResolvedValue({
      provider: "gemini",
      assistantMessage: { role: "assistant", content: "recovered" },
    });

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "openrouter", provider: fallback },
      { cooldown, now: () => new Date(now) },
    );

    await router.chat(input);
    expect(cooldown.get("gemini")).toBeUndefined();
    expect(fallback.chat).not.toHaveBeenCalled();
  });

  it("non-rate-limit recoverable errors do not enter cooldown", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    const cooldown = new ProviderCooldownRegistry();

    primary.chat.mockRejectedValue(new Error("request timed out"));
    fallback.chat.mockResolvedValue({
      assistantMessage: { role: "assistant", content: "fallback ok" },
    });

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "openrouter", provider: fallback },
      { cooldown, cooldownSeconds: 300, now: () => new Date(1_000) },
    );

    const result = await router.chat(input);
    expect(result.assistantMessage.content).toBe("fallback ok");
    expect(cooldown.get("gemini")).toBeUndefined();
  });

  it("cooldown log lines do not include API keys", async () => {
    const primary = new MockProvider();
    const fallback = new MockProvider();
    const cooldown = new ProviderCooldownRegistry();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    primary.chat.mockRejectedValue(
      new ProviderError(
        "quota exceeded api_key=AIzaSySecretValueHere12345",
        { recoverable: true, status: 429, provider: "gemini" },
      ),
    );
    fallback.chat.mockResolvedValue({
      assistantMessage: { role: "assistant", content: "ok" },
    });

    const router = new ProviderRouter(
      { name: "gemini", provider: primary },
      { name: "openrouter", provider: fallback },
      { cooldown, cooldownSeconds: 300 },
    );

    await router.chat(input);
    const joined = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(joined).toContain("[AI] Gemini unavailable for 300s: quota exhausted");
    expect(joined).not.toMatch(/AIzaSySecret/);
    expect(joined).not.toMatch(/api_key=/i);
  });
});
