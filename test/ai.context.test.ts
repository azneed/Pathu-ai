import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runChat } from "../src/ai/chat.js";
import { formatDeviceStateContext } from "../src/ai/prompt.js";
import type { LLMChatInput, LLMChatResult, LLMProvider } from "../src/ai/types.js";
import { openDb, type Db } from "../src/db/index.js";
import { Gateway } from "../src/devices/gateway.js";
import { createRegistry } from "../src/devices/registry.js";
import { SimulatedAdapter } from "../src/devices/simulated.js";

class CaptureProvider implements LLMProvider {
  readonly calls: LLMChatInput[] = [];
  private step = 0;

  constructor(private readonly responses: LLMChatResult[]) {}

  async chat(input: LLMChatInput): Promise<LLMChatResult> {
    this.calls.push(input);
    const response = this.responses[this.step];
    this.step += 1;
    if (!response) {
      throw new Error("CaptureProvider ran out of responses");
    }
    return response;
  }
}

function createStack() {
  const dir = mkdtempSync(join(tmpdir(), "andru-context-"));
  const db = openDb(join(dir, "test.db"));
  const adapter = new SimulatedAdapter(db);
  const gateway = new Gateway(createRegistry(adapter));
  return { db, gateway };
}

describe("Phase 1 conversation context", () => {
  let db: Db;

  afterEach(() => {
    db?.close();
  });

  it("injects current device state into the LLM context", async () => {
    const stack = createStack();
    db = stack.db;
    stack.gateway.set("bedroom.ac", { power: "on", temperature: 22 });

    const provider = new CaptureProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: "AC is at 22.",
        },
      },
    ]);

    await runChat({
      message: "What is the AC set to?",
      provider,
      gateway: stack.gateway,
      db: stack.db,
    });

    const firstCall = provider.calls[0];
    expect(firstCall).toBeTruthy();
    const stateMessage = firstCall!.messages.find(
      (message) =>
        message.role === "system" &&
        message.content.includes("authoritative ground truth"),
    );
    expect(stateMessage?.content).toContain('"temperature": 22');
    expect(stateMessage?.content).toContain("bedroom.ac");
    expect(formatDeviceStateContext(stack.gateway.getAll())).toContain(
      "authoritative ground truth",
    );
  });

  it("includes prior turns so follow-ups can resolve pronouns", async () => {
    const stack = createStack();
    db = stack.db;

    const first = new CaptureProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "c1",
              name: "set_ac",
              arguments: { power: "on", temperature: 22 },
            },
          ],
        },
      },
      {
        assistantMessage: {
          role: "assistant",
          content: "Done — AC at 22°C.",
        },
      },
    ]);

    await runChat({
      message: "Turn the AC to 22.",
      provider: first,
      gateway: stack.gateway,
      db: stack.db,
    });

    const second = new CaptureProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "c2",
              name: "set_ac",
              arguments: { temperature: 20 },
            },
          ],
        },
      },
      {
        assistantMessage: {
          role: "assistant",
          content: "Done — 20°C.",
        },
      },
    ]);

    const result = await runChat({
      message: "Make it 2 degrees cooler.",
      provider: second,
      gateway: stack.gateway,
      db: stack.db,
    });

    const followUpCall = second.calls[0]!;
    const userTexts = followUpCall.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content);
    expect(userTexts).toContain("Turn the AC to 22.");
    expect(userTexts).toContain("Make it 2 degrees cooler.");

    const stateMessage = followUpCall.messages.find(
      (message) =>
        message.role === "system" &&
        message.content.includes("authoritative ground truth"),
    );
    expect(stateMessage?.content).toContain('"temperature": 22');

    expect(result.devices["bedroom.ac"]).toMatchObject({ temperature: 20 });
    expect(result.reply).toContain("20");
  });

  it("refreshes device state in-context after a tool round", async () => {
    const stack = createStack();
    db = stack.db;

    const provider = new CaptureProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "c1",
              name: "set_lights",
              arguments: { power: "on", brightness: 40 },
            },
          ],
        },
      },
      {
        assistantMessage: {
          role: "assistant",
          content: "Lights at 40%.",
        },
      },
    ]);

    await runChat({
      message: "Set the lights to 40%.",
      provider,
      gateway: stack.gateway,
      db: stack.db,
    });

    expect(provider.calls).toHaveLength(2);
    const secondState = provider.calls[1]!.messages.find(
      (message) =>
        message.role === "system" &&
        message.content.includes("authoritative ground truth"),
    );
    expect(secondState?.content).toContain('"brightness": 40');
  });
});
