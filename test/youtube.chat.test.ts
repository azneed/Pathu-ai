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
import { resetYoutubeSession } from "../src/youtube/session.js";

class ScriptedProvider implements LLMProvider {
  private step = 0;
  constructor(private readonly responses: LLMChatResult[]) {}
  async chat(_input: LLMChatInput): Promise<LLMChatResult> {
    const response = this.responses[this.step++];
    if (!response) throw new Error("out of responses");
    return response;
  }
}

function createStack() {
  const dir = mkdtempSync(join(tmpdir(), "andru-yt-chat-"));
  const db = openDb(join(dir, "test.db"), { timeZone: "UTC" });
  const gateway = new Gateway(createRegistry(new SimulatedAdapter(db)));
  return { db, gateway };
}

describe("chat → YouTube clientActions", () => {
  let db: Db;

  afterEach(() => {
    resetYoutubeSession("default");
    db?.close();
  });

  it("returns clientActions for youtube_play without breaking devices field", async () => {
    const stack = createStack();
    db = stack.db;

    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "yt1",
              name: "youtube_play",
              arguments: { videoId: "dQw4w9WgXcQ", title: "Demo" },
            },
          ],
        },
      },
      {
        assistantMessage: {
          role: "assistant",
          content: "I queued that on the YouTube player.",
        },
      },
    ]);

    const result = await runChat({
      message: "Play that video.",
      provider,
      gateway: stack.gateway,
      db: stack.db,
      timeZone: "UTC",
      youtubeApiKey: "",
    });

    expect(result.reply).toMatch(/queued/i);
    expect(result.toolTrace[0]?.result).toMatchObject({
      playbackStatus: "queued",
    });
    expect(result.clientActions).toEqual([
      {
        type: "youtube",
        action: "play",
        videoId: "dQw4w9WgXcQ",
        title: "Demo",
      },
    ]);
    expect(result.devices["bedroom.ac"]).toBeTruthy();
  });

  it("device-only turns omit clientActions", async () => {
    const stack = createStack();
    db = stack.db;
    const provider = new ScriptedProvider([
      {
        assistantMessage: {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "ac1",
              name: "set_ac",
              arguments: { power: "on" },
            },
          ],
        },
      },
      {
        assistantMessage: { role: "assistant", content: "AC is on." },
      },
    ]);

    const result = await runChat({
      message: "Turn on the AC.",
      provider,
      gateway: stack.gateway,
      db: stack.db,
      timeZone: "UTC",
    });

    expect(result.clientActions).toBeUndefined();
    expect(result.devices["bedroom.ac"]).toMatchObject({ power: "on" });
  });
});
