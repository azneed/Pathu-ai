import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertAuthForHost, isLoopbackHost } from "../src/api/auth.js";
import { createApp } from "../src/api/routes.js";
import type { LLMProvider } from "../src/ai/types.js";
import { loadConfig } from "../src/config.js";
import { openDb, type Db } from "../src/db/index.js";
import { Gateway } from "../src/devices/gateway.js";
import { createRegistry } from "../src/devices/registry.js";
import { SimulatedAdapter } from "../src/devices/simulated.js";

const stubProvider: LLMProvider = {
  async chat() {
    return { provider: "test", assistantMessage: { role: "assistant", content: "ok" } };
  },
};

// Fresh per run; never logged or asserted against in messages.
const SECRET = randomBytes(32).toString("base64url");

describe("API bearer auth (PATHU_API_SECRET)", () => {
  let db: Db | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  function createTestApp(apiSecret?: string) {
    const dir = mkdtempSync(join(tmpdir(), "andru-auth-"));
    db = openDb(join(dir, "test.db"));
    const gateway = new Gateway(createRegistry(new SimulatedAdapter(db)));
    return createApp({ db, gateway, provider: stubProvider, apiSecret });
  }

  const chat = (headers: Record<string, string> = {}) => ({
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ message: "hello" }),
  });

  it("rejects /chat without Authorization with 401", async () => {
    const app = createTestApp(SECRET);
    const response = await app.request("/chat", chat());
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(db!.getMessages("default")).toHaveLength(0);
  });

  it("rejects a wrong secret or non-Bearer scheme with 401 and never echoes it", async () => {
    const app = createTestApp(SECRET);
    const wrong = randomBytes(32).toString("base64url");
    for (const authorization of [`Bearer ${wrong}`, `Basic ${SECRET}`, SECRET, "Bearer "]) {
      const response = await app.request("/chat", chat({ Authorization: authorization }));
      expect(response.status).toBe(401);
      const body = await response.text();
      expect(body).not.toContain(SECRET);
      expect(body).not.toContain(wrong);
    }
  });

  it("allows /chat with the correct secret (existing behavior)", async () => {
    const app = createTestApp(SECRET);
    const response = await app.request("/chat", chat({ Authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { reply: string; devices: unknown };
    expect(body.reply).toBe("ok");
    expect(body.devices).toBeTruthy();
  });

  it("keeps GET /health public", async () => {
    const app = createTestApp(SECRET);
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, name: "pathu" });
  });

  it("protects session reset and the other private/state-changing routes", async () => {
    const app = createTestApp(SECRET);
    const routes: Array<[string, RequestInit?]> = [
      ["/session/reset", { method: "POST" }],
      ["/devices"],
      ["/tasks"],
      ["/routines"],
      ["/routines/abc"],
      ["/routines", { method: "POST", body: "{}" }],
      ["/routines/abc", { method: "PATCH", body: "{}" }],
      ["/routines/abc", { method: "DELETE" }],
      ["/routines/abc/run", { method: "POST" }],
      ["/health", { method: "POST" }],
    ];
    for (const [path, init] of routes) {
      const response = await app.request(path, init);
      expect(response.status, `${init?.method ?? "GET"} ${path}`).toBe(401);
    }

    const reset = await app.request("/session/reset", {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(reset.status).toBe(200);
  });

  it("leaves the static voice shell public", async () => {
    const app = createTestApp(SECRET);
    expect((await app.request("/voice")).status).toBe(200);
    expect((await app.request("/voice-core.js")).status).toBe(200);
  });

  it("is disabled when no secret is configured (local loopback dev)", async () => {
    const app = createTestApp(undefined);
    expect((await app.request("/chat", chat())).status).toBe(200);
    expect((await app.request("/session/reset", { method: "POST" })).status).toBe(200);
  });

  it("refuses to start on a non-loopback host without a secret", () => {
    expect(() => assertAuthForHost("0.0.0.0", "")).toThrow(/PATHU_API_SECRET is required/);
    expect(() => assertAuthForHost("192.168.1.10", "")).toThrow();
    expect(() => assertAuthForHost("0.0.0.0", SECRET)).not.toThrow();
    expect(() => assertAuthForHost("127.0.0.1", "")).not.toThrow();
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
  });

  it("reads PATHU_API_SECRET from the environment, trimmed, empty by default", () => {
    expect(loadConfig({}).PATHU_API_SECRET).toBe("");
    expect(loadConfig({ PATHU_API_SECRET: `  ${SECRET}  ` }).PATHU_API_SECRET).toBe(SECRET);
  });
});
