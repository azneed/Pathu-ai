import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runChat } from "../src/ai/chat.js";
import { buildSystemPrompt } from "../src/ai/prompt.js";
import { executeTool, toolDefinitions } from "../src/ai/tools.js";
import type { LLMChatInput, LLMChatResult, LLMProvider } from "../src/ai/types.js";
import { createApp } from "../src/api/routes.js";
import { openDb, type Db } from "../src/db/index.js";
import { Gateway } from "../src/devices/gateway.js";
import { createRegistry } from "../src/devices/registry.js";
import { SimulatedAdapter } from "../src/devices/simulated.js";
import { describeCurrentTime, type CurrentTimeInfo } from "../src/tasks/time.js";

class ScriptedProvider implements LLMProvider {
  readonly calls: LLMChatInput[] = [];
  private step = 0;
  constructor(private readonly responses: LLMChatResult[]) {}
  async chat(input: LLMChatInput): Promise<LLMChatResult> {
    this.calls.push(input);
    const response = this.responses[this.step++];
    if (!response) throw new Error("ScriptedProvider ran out of responses");
    return response;
  }
}

/** Calls get_current_time, then answers with whatever the tool returned. */
class TimeAnsweringProvider implements LLMProvider {
  async chat(input: LLMChatInput): Promise<LLMChatResult> {
    const toolMessage = [...input.messages].reverse().find((m) => m.role === "tool");
    if (!toolMessage) {
      return {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "call_time", name: "get_current_time", arguments: {} }],
        },
      };
    }
    const info = JSON.parse(toolMessage.content ?? "{}") as CurrentTimeInfo;
    return {
      assistantMessage: { role: "assistant", content: `It's ${info.localTime}.` },
    };
  }
}

function createStack() {
  const dir = mkdtempSync(join(tmpdir(), "andru-time-"));
  const db = openDb(join(dir, "test.db"), { timeZone: "UTC" });
  const gateway = new Gateway(createRegistry(new SimulatedAdapter(db)));
  return { db, gateway };
}

describe("get_current_time", () => {
  let db: Db | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("is a registered tool and the prompt routes time questions to it", () => {
    expect(toolDefinitions.map((t) => t.name)).toContain("get_current_time");
    expect(buildSystemPrompt("Asia/Dubai")).toMatch(/get_current_time/);
  });

  it("renders the runtime instant in Asia/Dubai (UTC+4, no DST)", () => {
    const info = describeCurrentTime(new Date("2026-10-02T11:20:45.000Z"), "Asia/Dubai");
    expect(info).toMatchObject({
      timeZone: "Asia/Dubai",
      iso: "2026-10-02T11:20:45.000Z",
      utcOffset: "+04:00",
      localTime24: "15:20",
      dayOfWeek: "Friday",
    });
    expect(info.localTime).toMatch(/^3:20\s?PM$/);
    expect(info.localDate).toBe("Friday, October 2, 2026");
  });

  it("rolls the local date over across midnight and handles negative offsets", () => {
    expect(describeCurrentTime(new Date("2026-10-02T21:30:00.000Z"), "Asia/Dubai")).toMatchObject({
      localTime24: "01:30",
      dayOfWeek: "Saturday",
    });
    expect(describeCurrentTime(new Date("2026-01-15T03:00:00.000Z"), "America/New_York")).toMatchObject({
      utcOffset: "-05:00",
      localTime24: "22:00",
      dayOfWeek: "Wednesday",
    });
    expect(describeCurrentTime(new Date("2026-01-15T03:00:00.000Z"), "Asia/Kolkata").utcOffset).toBe("+05:30");
  });

  it("executes through the tool mechanism using the context clock and timezone", async () => {
    const stack = createStack();
    db = stack.db;
    const result = (await executeTool(
      "get_current_time",
      {},
      {
        gateway: stack.gateway,
        tasks: stack.db.tasks,
        timeZone: "Asia/Dubai",
        sessionId: "default",
        now: () => new Date("2026-10-02T05:05:00.000Z"),
      },
    )) as CurrentTimeInfo;
    expect(result.localTime24).toBe("09:05");
    await expect(
      executeTool("get_current_time", { zone: "UTC" }, {
        gateway: stack.gateway,
        tasks: stack.db.tasks,
        timeZone: "Asia/Dubai",
        sessionId: "default",
      }),
    ).rejects.toThrow();
  });

  it("answers 'What time is it?' via the /chat tool loop", async () => {
    const stack = createStack();
    db = stack.db;
    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "call_time", name: "get_current_time", arguments: {} }],
        },
      },
      { assistantMessage: { role: "assistant", content: "It's 3:20 PM in Dubai." } },
    ]);

    const result = await runChat({
      message: "What time is it?",
      provider,
      gateway: stack.gateway,
      db: stack.db,
      timeZone: "Asia/Dubai",
      now: () => new Date("2026-10-02T11:20:00.000Z"),
    });

    expect(result.reply).toBe("It's 3:20 PM in Dubai.");
    expect(result.toolTrace[0]).toMatchObject({
      name: "get_current_time",
      result: { timeZone: "Asia/Dubai", localTime24: "15:20" },
    });
    expect(provider.calls[0]?.tools.some((t) => t.name === "get_current_time")).toBe(true);
    expect(result.clientActions).toBeUndefined();
  });

  it("POST /chat returns the real runtime time, not a hardcoded one", async () => {
    const stack = createStack();
    db = stack.db;
    const app = createApp({
      db: stack.db,
      gateway: stack.gateway,
      provider: new TimeAnsweringProvider(),
      timeZone: "Asia/Dubai",
    });

    const before = Date.now();
    const response = await app.request("http://127.0.0.1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "what's the time right now" }),
    });
    const after = Date.now();

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      reply: string;
      toolTrace: Array<{ name: string; result: CurrentTimeInfo }>;
    };
    const info = body.toolTrace[0]!.result;
    expect(body.toolTrace[0]!.name).toBe("get_current_time");
    expect(info.timeZone).toBe("Asia/Dubai");
    const instant = new Date(info.iso).getTime();
    expect(instant).toBeGreaterThanOrEqual(before - 1000);
    expect(instant).toBeLessThanOrEqual(after + 1000);
    expect(body.reply).toBe(`It's ${info.localTime}.`);
  });
});
