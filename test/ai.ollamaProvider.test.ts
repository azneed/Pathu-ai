import { describe, expect, it, vi } from "vitest";
import {
  fromOllamaResponse,
  OllamaProvider,
  toOllamaMessages,
} from "../src/ai/ollamaProvider.js";
import { ProviderError } from "../src/ai/router.js";
import { toolDefinitions } from "../src/ai/tools.js";

describe("OllamaProvider", () => {
  it("converts Andru messages including tool calls", () => {
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
