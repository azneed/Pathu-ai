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
    const response = this.responses[this.step++];
    if (!response) throw new Error("ScriptedProvider ran out of responses");
    return response;
  }
}

function createStack() {
  const dir = mkdtempSync(join(tmpdir(), "andru-chat-routines-"));
  const db = openDb(join(dir, "test.db"), { timeZone: "UTC" });
  const adapter = new SimulatedAdapter(db);
  const gateway = new Gateway(createRegistry(adapter));
  return { db, gateway };
}

describe("chat → routines", () => {
  let db: Db;

  afterEach(() => {
    db?.close();
  });

  it("creates a routine via /chat tool loop without changing devices yet", async () => {
    const stack = createStack();
    db = stack.db;

    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "call_create",
              name: "create_routine",
              arguments: {
                name: "sleeping",
                description: "Night wind-down",
                actions: [
                  { tool: "set_ac", arguments: { power: "on", temperature: 24 } },
                  { tool: "set_lights", arguments: { power: "off" } },
                ],
              },
            },
          ],
        },
      },
      {
        assistantMessage: {
          role: "assistant",
          content: "Saved a sleeping routine. Say the word when you want me to run it.",
        },
      },
    ]);

    const result = await runChat({
      message:
        "Create a routine called sleeping that turns off the lights and sets AC to 24.",
      provider,
      gateway: stack.gateway,
      db: stack.db,
      timeZone: "UTC",
    });

    expect(result.toolTrace[0]?.name).toBe("create_routine");
    expect(result.reply).toMatch(/sleeping/i);
    expect(stack.db.routines.list()).toHaveLength(1);
    expect(await stack.gateway.get("bedroom.lights")).toMatchObject({ power: "off" });
    // default lights are already off — ensure AC was not turned on by create
    expect(await stack.gateway.get("bedroom.ac")).toMatchObject({ power: "off" });
  });

  it("runs a stored routine through chat tools", async () => {
    const stack = createStack();
    db = stack.db;
    stack.db.routines.create({
      name: "bedtime",
      actions: [
        { tool: "set_ac", arguments: { power: "on", temperature: 24 } },
        { tool: "set_fan", arguments: { power: "on", speed: 2 } },
        { tool: "set_lights", arguments: { power: "off" } },
      ],
    });

    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "call_run",
              name: "run_routine",
              arguments: { name: "bedtime" },
            },
          ],
        },
      },
      {
        assistantMessage: {
          role: "assistant",
          content: "Bedtime routine is done.",
        },
      },
    ]);

    const result = await runChat({
      message: "Run bedtime",
      provider,
      gateway: stack.gateway,
      db: stack.db,
      timeZone: "UTC",
    });

    expect(result.toolTrace[0]?.name).toBe("run_routine");
    expect(result.toolTrace[0]?.result).toMatchObject({ ok: true });
    expect(await stack.gateway.get("bedroom.ac")).toMatchObject({
      power: "on",
      temperature: 24,
    });
    expect(await stack.gateway.get("bedroom.fan")).toMatchObject({
      power: "on",
      speed: 2,
    });
  });

  it("updates a routine via chat tools", async () => {
    const stack = createStack();
    db = stack.db;
    stack.db.routines.create({
      name: "sleeping",
      actions: [{ tool: "set_lights", arguments: { power: "off" } }],
    });

    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "call_update",
              name: "update_routine",
              arguments: {
                name: "sleeping",
                actions: [
                  { tool: "set_lights", arguments: { power: "off" } },
                  { tool: "set_fan", arguments: { power: "on", speed: 1 } },
                ],
              },
            },
          ],
        },
      },
      {
        assistantMessage: {
          role: "assistant",
          content: "Updated your sleeping routine so the fan runs at speed 1.",
        },
      },
    ]);

    const result = await runChat({
      message: "Change my sleeping routine so the fan runs at speed 1",
      provider,
      gateway: stack.gateway,
      db: stack.db,
      timeZone: "UTC",
    });

    expect(result.toolTrace[0]?.name).toBe("update_routine");
    expect(stack.db.routines.findByName("sleeping")[0]?.actions).toHaveLength(2);
  });

  it("reports missing routine without pretending success", async () => {
    const stack = createStack();
    db = stack.db;

    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "call_run",
              name: "run_routine",
              arguments: { name: "movie mode" },
            },
          ],
        },
      },
      {
        assistantMessage: {
          role: "assistant",
          content: "I don't have a movie mode routine yet.",
        },
      },
    ]);

    const result = await runChat({
      message: "Activate movie mode",
      provider,
      gateway: stack.gateway,
      db: stack.db,
      timeZone: "UTC",
    });

    expect(result.toolTrace[0]?.result).toMatchObject({ ok: false });
    expect(result.reply).toMatch(/don't have|not/i);
  });
});
