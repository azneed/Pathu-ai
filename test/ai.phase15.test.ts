import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runChat } from "../src/ai/chat.js";
import { formatDeviceStateContext, SYSTEM_PROMPT } from "../src/ai/prompt.js";
import { toolDefinitions } from "../src/ai/tools.js";
import type { LLMChatInput, LLMChatResult, LLMProvider } from "../src/ai/types.js";
import { openDb, type Db } from "../src/db/index.js";
import { Gateway } from "../src/devices/gateway.js";
import { createRegistry } from "../src/devices/registry.js";
import { SimulatedAdapter } from "../src/devices/simulated.js";

class ScriptedProvider implements LLMProvider {
  private step = 0;
  constructor(private readonly responses: Array<LLMChatResult | Error>) {}
  async chat(_input: LLMChatInput): Promise<LLMChatResult> {
    const next = this.responses[this.step++];
    if (!next) throw new Error("no responses left");
    if (next instanceof Error) throw next;
    return next;
  }
}

function createStack() {
  const dir = mkdtempSync(join(tmpdir(), "andru-p15-"));
  const db = openDb(join(dir, "test.db"));
  const gateway = new Gateway(createRegistry(new SimulatedAdapter(db)));
  return { db, gateway };
}

describe("Phase 1.5 coverage improvements", () => {
  let db: Db | undefined;
  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("does not persist the user message when the LLM fails before responding", async () => {
    const stack = createStack();
    db = stack.db;
    const provider = new ScriptedProvider([
      new Error("Gemini 503 high demand"),
    ]);

    await expect(
      runChat({
        message: "Set the AC to 21 degrees.",
        provider,
        gateway: stack.gateway,
        db: stack.db,
      }),
    ).rejects.toThrow(/503/);

    expect(stack.db.getMessages("default")).toHaveLength(0);
  });

  it("keeps tool failure truthfulness path: error tool result is available to the model", async () => {
    const stack = createStack();
    db = stack.db;
    const calls: LLMChatInput[] = [];

    const provider: LLMProvider = {
      async chat(input) {
        calls.push(input);
        if (calls.length === 1) {
          return {
            assistantMessage: {
              role: "assistant",
              content: null,
              toolCalls: [
                {
                  id: "bad",
                  name: "set_ac",
                  arguments: { temperature: 10 },
                },
              ],
            },
          };
        }
        return {
          assistantMessage: {
            role: "assistant",
            content: "I could not set the AC to 10°C because it is out of range.",
          },
        };
      },
    };

    const result = await runChat({
      message: "Set the AC to 10 degrees.",
      provider,
      gateway: stack.gateway,
      db: stack.db,
    });

    expect(result.toolTrace[0]?.error).toBeTruthy();
    const toolMsg = calls[1]?.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("error");
    expect(result.reply.toLowerCase()).toMatch(/could not|out of range|fail/);
  });

  it("distinguishes lights vs rgb in prompt and tool descriptions", () => {
    expect(SYSTEM_PROMPT).toContain("bedroom.lights");
    expect(SYSTEM_PROMPT).toContain("bedroom.rgb");
    expect(SYSTEM_PROMPT).toMatch(/unsupported|cannot do that/i);

    const lights = toolDefinitions.find((t) => t.name === "set_lights");
    const rgb = toolDefinitions.find((t) => t.name === "set_rgb");
    expect(lights?.description).toMatch(/no color/i);
    expect(rgb?.description).toMatch(/RGB accent/i);
  });

  it("device state context lists capabilities and current JSON", () => {
    const text = formatDeviceStateContext({
      "bedroom.ac": { power: "on", temperature: 22 },
    });
    expect(text).toContain("authoritative ground truth");
    expect(text).toContain("bedroom.ac(power,temperature,mode,fanSpeed)");
    expect(text).toContain('"temperature": 22');
  });

  it("supports multi-tool combined commands in one turn", async () => {
    const stack = createStack();
    db = stack.db;
    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [
            { id: "1", name: "set_ac", arguments: { power: "on", temperature: 21 } },
            { id: "2", name: "set_fan", arguments: { power: "on", speed: 2 } },
          ],
        },
      },
      {
        assistantMessage: {
          role: "assistant",
          content: "AC is 21°C and fan is speed 2.",
        },
      },
    ]);

    const result = await runChat({
      message: "Set the AC to 21 and the fan to speed 2.",
      provider,
      gateway: stack.gateway,
      db: stack.db,
    });

    expect(result.toolTrace.map((t) => t.name)).toEqual(["set_ac", "set_fan"]);
    expect(result.devices["bedroom.ac"]).toMatchObject({
      power: "on",
      temperature: 21,
    });
    expect(result.devices["bedroom.fan"]).toMatchObject({
      power: "on",
      speed: 2,
    });
  });
});
