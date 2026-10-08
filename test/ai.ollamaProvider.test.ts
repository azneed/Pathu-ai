import { describe, expect, it, vi } from "vitest";
import {
  fromOllamaResponse,
  OllamaProvider,
  toOllamaMessages,
} from "../src/ai/ollamaProvider.js";
import { ProviderError } from "../src/ai/router.js";
import { toolDefinitions } from "../src/ai/tools.js";

describe("OllamaProvider", () => {
  it("converts Pathu messages including tool calls", () => {
    const messages = toOllamaMessages([
      { role: "system", content: "sys" },
      { role: "user", content: "fan speed 3" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          { id: "t1", name: "set_fan", arguments: { power: "on", speed: 3 } },
        ],
      },
      {
        role: "tool",
        toolCallId: "t1",
        toolName: "set_fan",
        content: JSON.stringify({ power: "on", speed: 3 }),
      },
    ]);

    expect(messages[2]).toMatchObject({
      role: "assistant",
      tool_calls: [
        {
          id: "t1",
          function: { name: "set_fan", arguments: { power: "on", speed: 3 } },
        },
      ],
    });
    expect(messages[3]).toMatchObject({
      role: "tool",
      tool_name: "set_fan",
      tool_call_id: "t1",
    });
  });

  it("maps a normal text response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { role: "assistant", content: "Hello from Ollama" },
      }),
    });

    const provider = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.2",
      fetchImpl,
    });

    const result = await provider.chat({
      messages: [{ role: "user", content: "hi" }],
      tools: toolDefinitions,
    });

    expect(result.provider).toBe("ollama");
    expect(result.assistantMessage.content).toBe("Hello from Ollama");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("maps tool calls from Ollama payload", () => {
    const result = fromOllamaResponse({
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "oc1",
            function: {
              name: "set_fan",
              arguments: { power: "on", speed: 3 },
            },
          },
        ],
      },
    });

    expect(result.assistantMessage.toolCalls).toEqual([
      {
        id: "oc1",
        name: "set_fan",
        arguments: { power: "on", speed: 3 },
      },
    ]);
  });

  it("marks HTTP failures as provider errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "unavailable",
    });

    const provider = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.2",
      fetchImpl,
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
        error.status === 503,
    );
  });
});

describe("OllamaProvider requests", () => {
  function okFetch() {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "ok" } }),
    });
  }

  function sent(fetchImpl: ReturnType<typeof okFetch>) {
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    return {
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    };
  }

  it("calls a local server without an Authorization header", async () => {
    const fetchImpl = okFetch();
    const provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", model: "llama3.2", fetchImpl });

    await provider.chat({ messages: [{ role: "user", content: "hi" }], tools: toolDefinitions });

    const request = sent(fetchImpl);
    expect(request.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(request.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("calls a remote base URL (with path) using the configured model and bearer key", async () => {
    const fetchImpl = okFetch();
    const provider = new OllamaProvider({
      baseUrl: "https://ollama.example.com/pathu/",
      model: "qwen3:8b",
      apiKey: "remote-ollama-key",
      fetchImpl,
    });

    await provider.chat({ messages: [{ role: "user", content: "hi" }], tools: toolDefinitions });

    const request = sent(fetchImpl);
    expect(request.url).toBe("https://ollama.example.com/pathu/api/chat");
    expect(request.body.model).toBe("qwen3:8b");
    expect(request.body.stream).toBe(false);
    expect(request.headers.Authorization).toBe("Bearer remote-ollama-key");
  });

  it("sends tools for a tool-enabled request", async () => {
    const fetchImpl = okFetch();
    const provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", model: "llama3.2", fetchImpl });

    await provider.chat({ messages: [{ role: "user", content: "hi" }], tools: toolDefinitions });

    const tools = sent(fetchImpl).body.tools as Array<{ type: string; function: { name: string } }>;
    expect(tools).toHaveLength(toolDefinitions.length);
    expect(tools.map((t) => t.function.name)).toContain("set_ac");
    expect(tools.every((t) => t.type === "function")).toBe(true);
  });

  it("omits tools entirely for a tool-disabled request", async () => {
    const fetchImpl = okFetch();
    const provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", model: "llama3.2", fetchImpl });

    await provider.chat({ messages: [{ role: "user", content: "hi" }], tools: [] });

    expect(sent(fetchImpl).body).not.toHaveProperty("tools");
  });

  it.each([401, 403])("treats HTTP %i from an auth proxy as recoverable", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status, text: async () => "denied" });
    const provider = new OllamaProvider({
      baseUrl: "https://ollama.example.com",
      model: "llama3.2",
      apiKey: "wrong-key",
      fetchImpl,
    });

    await expect(
      provider.chat({ messages: [{ role: "user", content: "hi" }], tools: [] }),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof ProviderError && error.recoverable && error.status === status,
    );
  });
});
