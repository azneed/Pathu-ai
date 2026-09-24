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
import { createApp } from "../src/api/routes.js";

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
  const dir = mkdtempSync(join(tmpdir(), "andru-chat-tasks-"));
  const db = openDb(join(dir, "test.db"), { timeZone: "UTC" });
  const adapter = new SimulatedAdapter(db);
  const gateway = new Gateway(createRegistry(adapter));
  return { db, gateway };
}

describe("chat → create_task (voice/API path)", () => {
  let db: Db;

  afterEach(() => {
    db?.close();
  });

  it("creates a delayed task via /chat tool loop without executing devices yet", async () => {
    const stack = createStack();
    db = stack.db;
    stack.gateway.set("bedroom.ac", { power: "on", temperature: 22 });

    const now = new Date("2026-09-19T12:00:00.000Z");
    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "call_task",
              name: "create_task",
              arguments: {
                description: "Turn AC off in 5 minutes",
                type: "delayed",
                delaySeconds: 300,
                actions: [{ tool: "set_ac", arguments: { power: "off" } }],
              },
            },
          ],
        },
      },
      {
        assistantMessage: {
          role: "assistant",
          content: "Okay, I'll turn the AC off in 5 minutes.",
        },
      },
    ]);

    const result = await runChat({
      message: "Turn off the AC in 5 minutes.",
      provider,
      gateway: stack.gateway,
      db: stack.db,
      timeZone: "UTC",
      now: () => now,
    });

    expect(result.reply).toMatch(/5 minutes/i);
    expect(result.toolTrace[0]?.name).toBe("create_task");
    expect(stack.gateway.get("bedroom.ac")).toMatchObject({ power: "on" });
    expect(stack.db.tasks.list({ status: "pending" })).toHaveLength(1);
  });

  it("executes a stored task without calling the LLM", async () => {
    const stack = createStack();
    db = stack.db;
    stack.gateway.set("bedroom.ac", { power: "on" });

    const task = stack.db.tasks.create({
      type: "delayed",
      description: "AC off",
      dueAt: new Date().toISOString(),
      sessionId: "default",
      actions: [{ tool: "set_ac", arguments: { power: "off" } }],
    });

    // Simulate Gemini outage: no provider involved
    const executed = stack.db.tasks.execute(task.id, stack.gateway);
    expect(executed.status).toBe("completed");
    expect(stack.gateway.get("bedroom.ac")).toMatchObject({ power: "off" });
  });

  it("exposes pending tasks on GET /tasks for voice/debug clients", async () => {
    const stack = createStack();
    db = stack.db;
    stack.db.tasks.create({
      type: "delayed",
      description: "Lights off soon",
      dueAt: new Date(Date.now() + 60_000).toISOString(),
      sessionId: "default",
      actions: [{ tool: "set_lights", arguments: { power: "off" } }],
    });

    const app = createApp({
      db: stack.db,
      gateway: stack.gateway,
      provider: new ScriptedProvider([]),
      timeZone: "UTC",
    });

    const response = await app.request("http://127.0.0.1/tasks");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tasks: Array<{ description: string }>;
    };
    expect(body.tasks.some((t) => t.description.includes("Lights"))).toBe(
      true,
    );
  });
});
