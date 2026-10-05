import { afterEach, describe, expect, it } from "vitest";
import { runChat } from "../src/ai/chat.js";
import type { LLMChatInput, LLMChatResult, LLMProvider } from "../src/ai/types.js";
import { openDb, type Db } from "../src/db/index.js";
import { Gateway } from "../src/devices/gateway.js";
import { createRegistry } from "../src/devices/registry.js";
import { HomeAssistantAdapter } from "../src/devices/homeassistant/adapter.js";
import { HomeAssistantClient } from "../src/devices/homeassistant/client.js";
import { DEVICE_IDS } from "../src/devices/types.js";
import {
  startFakeHomeAssistant,
  unusedLocalUrl,
  type FakeHomeAssistant,
} from "./helpers/fakeHomeAssistant.js";

class ScriptedProvider implements LLMProvider {
  readonly calls: LLMChatInput[] = [];
  private step = 0;

  constructor(private readonly responses: LLMChatResult[]) {}

  async chat(input: LLMChatInput): Promise<LLMChatResult> {
    this.calls.push(structuredClone(input));
    const response = this.responses[this.step];
    this.step += 1;
    if (!response) throw new Error("ScriptedProvider ran out of responses");
    return response;
  }
}

const HA_INTERNALS = [
  "climate.bedroom_ac",
  "fan.bedroom_fan",
  "light.bedroom_lights",
  "light.bedroom_rgb",
  "fake-ha-token",
  "127.0.0.1",
];

function haGateway(baseUrl: string, token: string) {
  const adapter = new HomeAssistantAdapter({
    client: new HomeAssistantClient({ baseUrl, token, retryDelayMs: 1, timeoutMs: 500 }),
  });
  return new Gateway(createRegistry(adapter), { onReadError: () => {} });
}

describe("chat with a Home Assistant backend", () => {
  let db: Db | undefined;
  let ha: FakeHomeAssistant | undefined;

  afterEach(async () => {
    db?.close();
    db = undefined;
    await ha?.close();
    ha = undefined;
  });

  it("still answers non-device requests when Home Assistant is down", async () => {
    db = openDb(":memory:");
    const gateway = haGateway(await unusedLocalUrl(), "fake-ha-token-chat");
    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "t1", name: "get_current_time", arguments: {} }],
        },
      },
      { assistantMessage: { role: "assistant", content: "It is 5 PM." } },
    ]);

    const result = await runChat({
      message: "What time is it?",
      provider,
      gateway,
      db,
      timeZone: "UTC",
      now: () => new Date("2026-10-05T17:00:00.000Z"),
    });

    expect(result.reply).toBe("It is 5 PM.");
    for (const id of DEVICE_IDS) expect(result.devices[id]).toEqual({ status: "unavailable" });
    const stateMessage = provider.calls[0]!.messages.find(
      (m) => m.role === "system" && m.content.startsWith("CURRENT DEVICE STATE"),
    );
    expect(stateMessage?.content).toContain("Unavailable right now: bedroom.ac, bedroom.fan, bedroom.lights, bedroom.rgb");
    const everything = JSON.stringify({ calls: provider.calls, result });
    for (const forbidden of HA_INTERNALS) expect(everything).not.toContain(forbidden);
  });

  it("turns a failed device tool into a safe tool error and finishes the turn", async () => {
    db = openDb(":memory:");
    ha = await startFakeHomeAssistant();
    ha.addFault("/api/services/", { type: "status", status: 500, body: "Traceback for light.bedroom_lights" });
    const gateway = haGateway(ha.url, ha.token);
    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "t1", name: "set_lights", arguments: { power: "on" } }],
        },
      },
      { assistantMessage: { role: "assistant", content: "Sorry, the lights did not respond." } },
    ]);

    const result = await runChat({ message: "Lights on", provider, gateway, db });

    expect(result.reply).toBe("Sorry, the lights did not respond.");
    expect(result.toolTrace[0]?.error).toBe("bedroom.lights: Home Assistant request failed (HTTP 500)");
    const everything = JSON.stringify({ calls: provider.calls, result });
    for (const forbidden of [...HA_INTERNALS, "Traceback"]) expect(everything).not.toContain(forbidden);
  });

  it("keeps a typical device turn to a handful of Home Assistant requests", async () => {
    db = openDb(":memory:");
    ha = await startFakeHomeAssistant();
    const gateway = haGateway(ha.url, ha.token);
    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "t1", name: "set_lights", arguments: { power: "on", brightness: 50 } }],
        },
      },
      { assistantMessage: { role: "assistant", content: "Lights are on at 50%." } },
    ]);

    const result = await runChat({ message: "Lights to 50%", provider, gateway, db });

    expect(result.devices["bedroom.lights"]).toEqual({ power: "on", brightness: 50 });
    expect(ha.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /api/states",
      "POST /api/services/light/turn_on",
      "GET /api/states/light.bedroom_lights",
    ]);
    // the second LLM round sees the post-command state
    expect(JSON.stringify(provider.calls[1]!.messages[1])).toContain('\\"brightness\\": 50');
  });
});
