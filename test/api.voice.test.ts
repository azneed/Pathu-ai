import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/api/routes.js";
import type { LLMProvider } from "../src/ai/types.js";
import { openDb, type Db } from "../src/db/index.js";
import { Gateway } from "../src/devices/gateway.js";
import { createRegistry } from "../src/devices/registry.js";
import { SimulatedAdapter } from "../src/devices/simulated.js";

const stubProvider: LLMProvider = {
  async chat() {
    return {
      provider: "test",
      assistantMessage: { role: "assistant", content: "ok" },
    };
  },
};

describe("voice HTTP routes", () => {
  let db: Db | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  function createTestApp() {
    const dir = mkdtempSync(join(tmpdir(), "andru-voice-"));
    db = openDb(join(dir, "test.db"));
    const gateway = new Gateway(createRegistry(new SimulatedAdapter(db)));
    return createApp({ db, gateway, provider: stubProvider });
  }

  it("GET /voice returns the voice HTML page", async () => {
    const app = createTestApp();
    const response = await app.request("/voice");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Pathu");
    expect(html).toContain("Hold to talk");
    expect(html).toContain("/chat");
    expect(html).toContain("Hands-free");
    expect(html).toContain("Push-to-talk");
    expect(html).toContain("/voice-core.js");
    expect(html).toContain("Say Hey Pathu");
    expect(html).toContain('id="musicAudio"');
    expect(html).toContain("Enable music audio");
    expect(html).not.toContain("AUDIUS_API_KEY");
    expect(html).not.toContain("Hey Andru");
    expect(response.headers.get("content-type") ?? "").toMatch(/html/i);
  });

  it("GET /voice-core.js serves wake/state helpers", async () => {
    const app = createTestApp();
    const response = await app.request("/voice-core.js");
    expect(response.status).toBe(200);
    const js = await response.text();
    expect(js).toContain("PathuVoiceCore");
    expect(js).toContain("hey pathu");
    expect(js).toContain("extractCommandAfterWake");
    expect(js).toContain("createTranscriptWakeDetector");
    expect(js).not.toContain("hey andru");
    expect(response.headers.get("content-type") ?? "").toMatch(/javascript/i);
  });

  it("POST /session/reset clears conversation messages", async () => {
    const app = createTestApp();
    db!.appendMessage("default", { role: "user", content: "hi" });
    expect(db!.getMessages("default")).toHaveLength(1);

    const response = await app.request("/session/reset", { method: "POST" });
    expect(response.status).toBe(200);
    expect(db!.getMessages("default")).toHaveLength(0);
  });
});
