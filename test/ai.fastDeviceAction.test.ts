import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runChat } from "../src/ai/chat.js";
import { detectFastDeviceAction } from "../src/ai/fastDeviceAction.js";
import type { LLMChatInput, LLMChatResult, LLMProvider } from "../src/ai/types.js";
import { openDb, type Db } from "../src/db/index.js";
import { Gateway } from "../src/devices/gateway.js";
import { HomeAssistantAdapter } from "../src/devices/homeassistant/adapter.js";
import { HomeAssistantClient } from "../src/devices/homeassistant/client.js";
import { createRegistry } from "../src/devices/registry.js";
import { SimulatedAdapter } from "../src/devices/simulated.js";
import type { DeviceGateway } from "../src/devices/types.js";
import { startFakeHomeAssistant, type FakeHomeAssistant } from "./helpers/fakeHomeAssistant.js";

class ScriptedProvider implements LLMProvider {
  readonly calls: LLMChatInput[] = [];
  private step = 0;

  constructor(private readonly responses: Array<LLMChatResult | Error>) {}

  async chat(input: LLMChatInput): Promise<LLMChatResult> {
    this.calls.push(structuredClone(input));
    const response = this.responses[this.step];
    this.step += 1;
    if (!response) throw new Error("ScriptedProvider ran out of responses");
    if (response instanceof Error) throw response;
    return response;
  }
}

function reply(content: string): LLMChatResult {
  return { assistantMessage: { role: "assistant", content }, provider: "gemini", model: "test-model" };
}

function simulatedStack() {
  const dir = mkdtempSync(join(tmpdir(), "andru-fast-"));
  const db = openDb(join(dir, "test.db"));
  const gateway = new Gateway(createRegistry(new SimulatedAdapter(db)));
  return { db, gateway };
}

function haGateway(ha: FakeHomeAssistant) {
  const adapter = new HomeAssistantAdapter({
    client: new HomeAssistantClient({ baseUrl: ha.url, token: ha.token, retryDelayMs: 1, timeoutMs: 500 }),
  });
  return new Gateway(createRegistry(adapter), { onReadError: () => {} });
}

describe("detectFastDeviceAction", () => {
  it.each([
    ["Turn on the hall AC", "hall.ac", "on"],
    ["Turn off the hall AC", "hall.ac", "off"],
    ["Turn on the bedroom AC", "bedroom.ac", "on"],
    ["Turn off the bedroom AC", "bedroom.ac", "off"],
    ["Switch the hall AC off", "hall.ac", "off"],
    ["Please turn on bedroom AC", "bedroom.ac", "on"],
    ["turn the bedroom ac on.", "bedroom.ac", "on"],
    ["Hey Pathu, switch off the hall A/C please", "hall.ac", "off"],
    ["Can you please power on my bedroom air conditioner?", "bedroom.ac", "on"],
    ["  TURN OFF THE HALL A.C. NOW!  ", "hall.ac", "off"],
    ["Could you turn the hall AC off for me, thanks", "hall.ac", "off"],
  ])("detects %j", (message, deviceId, power) => {
    expect(detectFastDeviceAction(message)).toEqual({
      tool: "set_ac",
      deviceId,
      power,
      arguments: { device: deviceId, power },
    });
  });

  it.each([
    "Turn on the AC.",
    "Turn off the AC",
    "Turn off the AC in 5 minutes.",
    "Turn off the hall AC in 5 minutes",
    "Turn the AC to 22.",
    "Turn on the hall AC and set it to 23 degrees",
    "Turn the AC on and set it to 23 degrees.",
    "Turn on the hall AC and the bedroom fan",
    "Turn on the kitchen AC",
    "Turn on the bedroom fan",
    "Turn on the hall lights",
    "Is the hall AC on?",
    "Don't turn on the hall AC",
    "Turn on the hall AC or the bedroom AC",
    "Set the bedroom AC to cool",
    "What time is it?",
    "",
  ])("leaves %j to the normal LLM flow", (message) => {
    expect(detectFastDeviceAction(message)).toBeNull();
  });
});

describe("runChat fast device path", () => {
  let db: Db | undefined;
  let ha: FakeHomeAssistant | undefined;

  afterEach(async () => {
    db?.close();
    db = undefined;
    await ha?.close();
    ha = undefined;
  });

  it.each([
    ["Turn on the bedroom AC", "on"],
    ["Switch the bedroom AC off", "off"],
  ] as const)("executes %j via set_ac, then asks the LLM without tools", async (message, power) => {
    const stack = simulatedStack();
    db = stack.db;
    const provider = new ScriptedProvider([reply(`The bedroom AC is now ${power}.`)]);

    const result = await runChat({ message, provider, gateway: stack.gateway, db, timeZone: "UTC" });

    expect(result.reply).toBe(`The bedroom AC is now ${power}.`);
    expect(result.provider).toBe("gemini");
    expect(result.model).toBe("test-model");
    expect(result.toolTrace).toEqual([
      { name: "set_ac", arguments: { device: "bedroom.ac", power }, result: expect.objectContaining({ power }) },
    ]);
    expect(result.devices["bedroom.ac"]).toMatchObject({ power });

    expect(provider.calls).toHaveLength(1);
    const call = provider.calls[0]!;
    expect(call.tools).toEqual([]);
    const last = call.messages.at(-1)!;
    expect(last.role).toBe("system");
    expect(last.content).toContain("DEVICE ACTION ALREADY EXECUTED");
    expect(last.content).toContain(`set_ac {"device":"bedroom.ac","power":"${power}"}`);
    expect(last.content).toContain("Result: success");

    expect(db.getMessages("default")).toEqual([
      { role: "user", content: message },
      { role: "assistant", content: `The bedroom AC is now ${power}.` },
    ]);
  });

  it.each(["on", "off"] as const)(
    "sends the hall AC IR power toggle (%s) through Home Assistant and keeps it unconfirmed",
    async (power) => {
      db = openDb(":memory:");
      ha = await startFakeHomeAssistant();
      const provider = new ScriptedProvider([reply("I've sent the power signal to the hall AC.")]);

      const result = await runChat({
        message: `Turn ${power} the hall AC`,
        provider,
        gateway: haGateway(ha),
        db,
        timeZone: "UTC",
      });

      expect(result.reply).toBe("I've sent the power signal to the hall AC.");
      const sendCalls = ha.requests.filter((r) => r.path === "/api/services/remote/send_command");
      expect(sendCalls).toHaveLength(1);
      expect(sendCalls[0]?.body).toEqual({
        entity_id: "remote.pathu",
        device: "Air conditioner - Hall",
        command: "power",
      });
      expect(result.toolTrace[0]?.result).toMatchObject({ powerStateUnconfirmed: true });

      const messages = provider.calls[0]!.messages;
      const instruction = messages.at(-1)!.content;
      expect(provider.calls[0]!.tools).toEqual([]);
      expect(instruction).toContain(`requested power-${power} command for the Hall AC was sent`);
      expect(instruction).toContain("Physical power state: unconfirmed");
      expect(instruction).toContain("do NOT claim the Hall AC is now physically on or off");
      for (const placeholder of ['"power":"off"', '"power":"on"', '"temperature":24', '"mode":"cool"']) {
        expect(instruction).not.toContain(placeholder);
      }
      expect(instruction).not.toContain("Reported device state");

      const stateContext = messages.find(
        (m) => m.role === "system" && m.content.startsWith("CURRENT DEVICE STATE"),
      )!.content;
      const hallEntry = /"hall\.ac": (\{[^}]*\})/.exec(stateContext ?? "")?.[1];
      expect(JSON.parse(hallEntry!)).toEqual({ powerStateUnconfirmed: true });

      expect(result.devices["hall.ac"]).toMatchObject({ powerStateUnconfirmed: true });
    },
  );

  it("sends only plain text history to the tool-free reply call", async () => {
    const stack = simulatedStack();
    db = stack.db;
    db.appendMessage("default", { role: "user", content: "Lights on" });
    db.appendMessage("default", {
      role: "assistant",
      content: null,
      toolCalls: [{ id: "t1", name: "set_lights", arguments: { power: "on" } }],
    });
    db.appendMessage("default", { role: "tool", toolCallId: "t1", toolName: "set_lights", content: "{}" });
    db.appendMessage("default", { role: "assistant", content: "Lights are on." });
    const provider = new ScriptedProvider([reply("Done.")]);

    await runChat({ message: "Turn on the bedroom AC", provider, gateway: stack.gateway, db });

    const messages = provider.calls[0]!.messages;
    expect(messages.some((m) => m.role === "tool")).toBe(false);
    expect(messages.some((m) => m.role === "assistant" && m.toolCalls)).toBe(false);
    expect(messages.filter((m) => m.role === "user" || m.role === "assistant")).toEqual([
      { role: "user", content: "Lights on" },
      { role: "assistant", content: "Lights are on." },
      { role: "user", content: "Turn on the bedroom AC" },
    ]);
  });

  it("returns a deterministic reply when the LLM fails after a successful hall AC action", async () => {
    db = openDb(":memory:");
    ha = await startFakeHomeAssistant();
    const provider = new ScriptedProvider([new Error("Gemini unavailable")]);

    const result = await runChat({ message: "Turn off the hall AC", provider, gateway: haGateway(ha), db });

    expect(result.reply).toBe("Done. I've sent the power command to the Hall AC.");
    expect(result.provider).toBeUndefined();
    expect(ha.requests.filter((r) => r.path === "/api/services/remote/send_command")).toHaveLength(1);
    expect(db.getMessages("default").at(-1)).toEqual({
      role: "assistant",
      content: "Done. I've sent the power command to the Hall AC.",
    });
  });

  it("states the confirmed power truthfully when the LLM fails for the bedroom AC", async () => {
    const stack = simulatedStack();
    db = stack.db;
    const provider = new ScriptedProvider([new Error("Gemini unavailable")]);

    const result = await runChat({ message: "Turn on the bedroom AC", provider, gateway: stack.gateway, db });

    expect(result.reply).toBe("Done. The Bedroom AC is now on.");
  });

  it("falls back deterministically when the LLM reply is empty or still tries to call tools", async () => {
    const stack = simulatedStack();
    db = stack.db;
    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "x", name: "set_ac", arguments: { device: "bedroom.ac", power: "off" } }],
        },
      },
    ]);

    const result = await runChat({ message: "Turn on the bedroom AC", provider, gateway: stack.gateway, db });

    expect(result.reply).toBe("Done. The Bedroom AC is now on.");
    expect(result.toolTrace).toHaveLength(1);
    expect(result.devices["bedroom.ac"]).toMatchObject({ power: "on" });
  });

  it("never claims success when the physical action fails (Home Assistant error)", async () => {
    db = openDb(":memory:");
    ha = await startFakeHomeAssistant();
    ha.addFault("/api/services/remote/send_command", { type: "status", status: 500, body: "Traceback" });
    const provider = new ScriptedProvider([reply("Done! The hall AC is on.")]);

    const result = await runChat({ message: "Turn on the hall AC", provider, gateway: haGateway(ha), db });

    expect(result.reply).toBe(
      "Sorry, I couldn't send the power-on command to the Hall AC. Home Assistant request failed (HTTP 500).",
    );
    expect(result.reply).not.toMatch(/\bdone\b|sent the power command/i);
    expect(provider.calls).toHaveLength(0);
    expect(result.toolTrace).toEqual([
      {
        name: "set_ac",
        arguments: { device: "hall.ac", power: "on" },
        error: "hall.ac: Home Assistant request failed (HTTP 500)",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("Traceback");
    expect(db.getMessages("default").at(-1)).toEqual({ role: "assistant", content: result.reply });
  });

  it("does not expose unexpected error details when the action fails", async () => {
    const stack = simulatedStack();
    db = stack.db;
    const gateway: DeviceGateway = {
      get: (id) => stack.gateway.get(id),
      getAll: () => stack.gateway.getAll(),
      set: async () => {
        throw new Error("socket hang up at 10.0.0.5");
      },
    };
    const provider = new ScriptedProvider([reply("Done!")]);

    const result = await runChat({ message: "Turn off the bedroom AC", provider, gateway, db });

    expect(result.reply).toBe("Sorry, I couldn't send the power-off command to the Bedroom AC.");
    expect(provider.calls).toHaveLength(0);
    expect(result.toolTrace[0]?.error).toBe("socket hang up at 10.0.0.5");
  });

  it("leaves ambiguous and complex device requests on the normal tool-calling flow", async () => {
    const stack = simulatedStack();
    db = stack.db;
    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "t1", name: "set_ac", arguments: { power: "on", temperature: 23 } }],
        },
      },
      reply("The AC is on at 23 degrees."),
    ]);

    const result = await runChat({
      message: "Turn the AC on and set it to 23 degrees.",
      provider,
      gateway: stack.gateway,
      db,
    });

    expect(result.reply).toBe("The AC is on at 23 degrees.");
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]!.tools.length).toBeGreaterThan(0);
    expect(provider.calls[0]!.tools.map((t) => t.name)).toContain("set_ac");
  });

  it("keeps normal questions such as the time on the existing flow", async () => {
    const stack = simulatedStack();
    db = stack.db;
    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "t1", name: "get_current_time", arguments: {} }],
        },
      },
      reply("It is 5 PM."),
    ]);

    const result = await runChat({
      message: "What time is it?",
      provider,
      gateway: stack.gateway,
      db,
      timeZone: "UTC",
      now: () => new Date("2026-10-05T17:00:00.000Z"),
    });

    expect(result.reply).toBe("It is 5 PM.");
    expect(result.toolTrace.map((t) => t.name)).toEqual(["get_current_time"]);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]!.tools.length).toBeGreaterThan(0);
  });
});
