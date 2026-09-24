import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runChat } from "../src/ai/chat.js";
import type { LLMChatInput, LLMChatResult, LLMProvider } from "../src/ai/types.js";
import { openDb, type Db } from "../src/db/index.js";
import { Gateway } from "../src/devices/gateway.js";
import { createRegistry } from "../src/devices/registry.js";
import { SimulatedAdapter } from "../src/devices/simulated.js";

class ScriptedProvider implements LLMProvider {
  private step = 0;

  constructor(private readonly responses: LLMChatResult[]) {}

  async chat(_input: LLMChatInput): Promise<LLMChatResult> {
    const response = this.responses[this.step];
    this.step += 1;
    if (!response) {
      throw new Error("ScriptedProvider ran out of responses");
    }
    return response;
  }
}

function createStack() {
  const dir = mkdtempSync(join(tmpdir(), "andru-chat-"));
  const db = openDb(join(dir, "test.db"));
  const adapter = new SimulatedAdapter(db);
  const gateway = new Gateway(createRegistry(adapter));
  return { db, gateway };
}

describe("runChat with mocked LLMProvider", () => {
  let db: Db;

  afterEach(() => {
    db?.close();
  });

  it("executes set_ac tool call and returns final reply", async () => {
    const stack = createStack();
    db = stack.db;

    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "call_1",
              name: "set_ac",
              arguments: { power: "on", temperature: 23 },
            },
          ],
        },
      },
      {
        assistantMessage: {
          role: "assistant",
          content: "AC is on at 23 degrees.",
        },
      },
    ]);

    const result = await runChat({
      message: "Turn the AC on and set it to 23 degrees.",
      provider,
      gateway: stack.gateway,
      db: stack.db,
    });

    expect(result.reply).toBe("AC is on at 23 degrees.");
    expect(result.devices["bedroom.ac"]).toMatchObject({
      power: "on",
      temperature: 23,
    });
    expect(result.toolTrace).toHaveLength(1);
    expect(result.toolTrace[0]?.name).toBe("set_ac");

    const messages = stack.db.getMessages("default");
    expect(messages.some((m) => m.role === "user")).toBe(true);
    expect(messages.some((m) => m.role === "tool")).toBe(true);
    expect(messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("records tool errors without crashing", async () => {
    const stack = createStack();
    db = stack.db;

    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "call_bad",
              name: "set_ac",
              arguments: { temperature: 99 },
            },
          ],
        },
      },
      {
        assistantMessage: {
          role: "assistant",
          content: "That temperature is out of range.",
        },
      },
    ]);

    const result = await runChat({
      message: "Set AC to 99",
      provider,
      gateway: stack.gateway,
      db: stack.db,
    });

    expect(result.reply).toContain("out of range");
    expect(result.toolTrace[0]?.error).toBeTruthy();
  });
});
