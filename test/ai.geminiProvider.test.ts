import { describe, expect, it, vi } from "vitest";
import {
  fromGeminiResponse,
  GeminiProvider,
  toGeminiRequest,
} from "../src/ai/geminiProvider.js";
import type { LLMChatInput } from "../src/ai/types.js";
import { toolDefinitions } from "../src/ai/tools.js";

const sampleInput: LLMChatInput = {
  messages: [
    { role: "system", content: "You are Pathu." },
    { role: "user", content: "Turn AC to 22" },
  ],
  tools: toolDefinitions,
};

describe("GeminiProvider", () => {
  it("converts Pathu messages into Gemini contents and system instruction", () => {
    const converted = toGeminiRequest([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          { id: "c1", name: "set_ac", arguments: { temperature: 22 } },
        ],
      },
      {
        role: "tool",
        toolCallId: "c1",
        toolName: "set_ac",
        content: JSON.stringify({ power: "on", temperature: 22 }),
      },
    ]);

    expect(converted.systemInstruction).toBe("sys");
    expect(converted.contents[0]).toEqual({
      role: "user",
      parts: [{ text: "hi" }],
    });
    expect(converted.contents[1]?.role).toBe("model");
    expect(converted.contents[2]).toMatchObject({
      role: "user",
      parts: [
        {
          functionResponse: {
            id: "c1",
            name: "set_ac",
          },
        },
      ],
    });
  });

  it("maps a normal text response", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "Hello from Gemini",
      functionCalls: [],
    });

    const provider = new GeminiProvider({
      apiKey: "test-key",
      model: "gemini-2.0-flash",
      client: { models: { generateContent } },
    });

    const result = await provider.chat(sampleInput);
    expect(result.provider).toBe("gemini");
    expect(result.assistantMessage.content).toBe("Hello from Gemini");
    expect(result.assistantMessage.toolCalls).toBeUndefined();
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it("maps tool calls from Gemini functionCalls", () => {
    const result = fromGeminiResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                thoughtSignature: "sig-abc",
                functionCall: {
                  id: "fc1",
                  name: "set_ac",
                  args: { power: "on", temperature: 22 },
                },
              },
            ],
          },
        },
      ],
    });

    expect(result.assistantMessage.toolCalls).toEqual([
      {
        id: "fc1",
        name: "set_ac",
        arguments: { power: "on", temperature: 22 },
        thoughtSignature: "sig-abc",
      },
    ]);
  });

  it("replays thoughtSignature on functionCall parts", () => {
    const converted = toGeminiRequest([
      {
        role: "assistant",
        content: null,
        toolCalls: [
          {
            id: "fc1",
            name: "set_ac",
            arguments: { temperature: 22 },
            thoughtSignature: "sig-abc",
          },
        ],
      },
    ]);

    expect(converted.contents[0]?.parts[0]).toEqual({
      functionCall: {
        id: "fc1",
        name: "set_ac",
        args: { temperature: 22 },
      },
      thoughtSignature: "sig-abc",
    });
  });

  it("maps tool results back into Gemini functionResponse parts", () => {
    const converted = toGeminiRequest([
      {
        role: "tool",
        toolCallId: "fc1",
        toolName: "get_devices",
        content: JSON.stringify({ "bedroom.ac": { power: "off" } }),
      },
    ]);

    expect(converted.contents[0]?.parts[0]).toEqual({
      functionResponse: {
        id: "fc1",
        name: "get_devices",
        response: { "bedroom.ac": { power: "off" } },
      },
    });
  });
});
