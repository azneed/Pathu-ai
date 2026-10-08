import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runChat } from "../src/ai/chat.js";
import { createLLMProvider } from "../src/ai/createLLMProvider.js";
import { OllamaProvider } from "../src/ai/ollamaProvider.js";
import { ProviderRouter } from "../src/ai/router.js";
import { toolDefinitions } from "../src/ai/tools.js";
import type { LLMChatInput, LLMChatResult, LLMProvider } from "../src/ai/types.js";
import { loadConfig } from "../src/config.js";
import { openDb, type Db } from "../src/db/index.js";
import { Gateway } from "../src/devices/gateway.js";
import { createRegistry } from "../src/devices/registry.js";
import { SimulatedAdapter } from "../src/devices/simulated.js";

const OLLAMA_KEY = "ollama-test-key-must-never-appear-0123456789";
const REMOTE_ENV = {
  AI_PRIMARY: "ollama",
  OLLAMA_BASE_URL: "https://ollama.example.com/",
  OLLAMA_MODEL: "qwen3:8b",
  OLLAMA_API_KEY: ` ${OLLAMA_KEY} `,
};

function configError(env: NodeJS.ProcessEnv): string {
  try {
    loadConfig(env);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected loadConfig to throw");
}

function ollamaReply(content: string) {
  return { ok: true, json: async () => ({ message: { role: "assistant", content } }) };
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<unknown>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function request(fetchMock: ReturnType<typeof stubFetch>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
}

const input: LLMChatInput = { messages: [{ role: "user", content: "hi" }], tools: toolDefinitions };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ollama configuration", () => {
  it("defaults to a local Ollama without a key", () => {
    const config = loadConfig({ AI_PRIMARY: "ollama" });
    expect(config.OLLAMA_BASE_URL).toBe("http://127.0.0.1:11434");
    expect(config.OLLAMA_MODEL).toBe("llama3.2");
    expect(config.OLLAMA_API_KEY).toBe("");
  });

  it("treats blank values as unset", () => {
    const config = loadConfig({ AI_PRIMARY: "ollama", OLLAMA_BASE_URL: "  ", OLLAMA_MODEL: "", OLLAMA_API_KEY: " " });
    expect(config.OLLAMA_BASE_URL).toBe("http://127.0.0.1:11434");
    expect(config.OLLAMA_MODEL).toBe("llama3.2");
    expect(config.OLLAMA_API_KEY).toBe("");
  });

  it("accepts a remote base URL, model and key", () => {
    const config = loadConfig({ ...REMOTE_ENV, OLLAMA_BASE_URL: " https://ollama.example.com:8443/pathu/ " });
    expect(config.OLLAMA_BASE_URL).toBe("https://ollama.example.com:8443/pathu");
    expect(config.OLLAMA_MODEL).toBe("qwen3:8b");
    expect(config.OLLAMA_API_KEY).toBe(OLLAMA_KEY);
  });

  it.each([
    ["primary", { AI_PRIMARY: "ollama" }],
    ["fallback", { AI_PRIMARY: "gemini", AI_FALLBACK: "ollama" }],
  ])("rejects an invalid OLLAMA_BASE_URL when Ollama is the %s", (_role, env) => {
    expect(configError({ ...env, OLLAMA_BASE_URL: "ollama.example.com:11434" })).toMatch(
      /OLLAMA_BASE_URL: must be an http\(s\) URL/,
    );
  });

  it("rejects credentials in the URL without echoing them", () => {
    const message = configError({ AI_PRIMARY: "ollama", OLLAMA_BASE_URL: `https://user:${OLLAMA_KEY}@ollama.example.com` });
    expect(message).toMatch(/OLLAMA_BASE_URL/);
    expect(message).not.toContain(OLLAMA_KEY);
  });

  it("ignores Ollama settings when Ollama is not selected", () => {
    const config = loadConfig({ AI_PRIMARY: "gemini", AI_FALLBACK: "openrouter", OLLAMA_BASE_URL: "not a url" });
    expect(config.AI_PRIMARY).toBe("gemini");
  });

  it("keeps AI_PRIMARY / AI_FALLBACK selectable in both directions", () => {
    expect(loadConfig({ AI_PRIMARY: "gemini", AI_FALLBACK: "ollama" })).toMatchObject({
      AI_PRIMARY: "gemini",
      AI_FALLBACK: "ollama",
    });
    expect(loadConfig({ AI_PRIMARY: "ollama", AI_FALLBACK: "gemini" })).toMatchObject({
      AI_PRIMARY: "ollama",
      AI_FALLBACK: "gemini",
    });
  });
});

describe("createLLMProvider with Ollama", () => {
  it("creates a remote Ollama primary from env only", async () => {
    const fetchMock = stubFetch(async () => ollamaReply("hello from remote ollama"));
    const provider = createLLMProvider(loadConfig(REMOTE_ENV));

    const result = await provider.chat(input);

    expect(result.provider).toBe("ollama");
    expect(result.assistantMessage.content).toBe("hello from remote ollama");
    const sent = request(fetchMock);
    expect(sent.url).toBe("https://ollama.example.com/api/chat");
    expect(sent.body.model).toBe("qwen3:8b");
    expect(sent.headers.Authorization).toBe(`Bearer ${OLLAMA_KEY}`);
  });

  it("creates a local Ollama primary without an Authorization header", async () => {
    const fetchMock = stubFetch(async () => ollamaReply("local"));
    const provider = createLLMProvider(loadConfig({ AI_PRIMARY: "ollama" }));

    await provider.chat(input);

    const sent = request(fetchMock);
    expect(sent.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(sent.body.model).toBe("llama3.2");
    expect(sent.headers).not.toHaveProperty("Authorization");
  });

  it("falls back from Gemini to Ollama (AI_PRIMARY=gemini, AI_FALLBACK=ollama)", async () => {
    const fetchMock = stubFetch(async () => ollamaReply("ollama fallback reply"));
    const provider = createLLMProvider(
      loadConfig({ ...REMOTE_ENV, AI_PRIMARY: "gemini", AI_FALLBACK: "ollama", GEMINI_API_KEY: "" }),
    );

    const result = await provider.chat(input);

    expect(result.provider).toBe("ollama");
    expect(result.assistantMessage.content).toBe("ollama fallback reply");
    expect(request(fetchMock).url).toBe("https://ollama.example.com/api/chat");
  });

  it("tries Gemini after Ollama fails (AI_PRIMARY=ollama, AI_FALLBACK=gemini)", async () => {
    const fetchMock = stubFetch(async () => ({ ok: false, status: 503, text: async () => "loading" }));
    const provider = createLLMProvider(
      loadConfig({ ...REMOTE_ENV, AI_FALLBACK: "gemini", GEMINI_API_KEY: "" }),
    );

    await expect(provider.chat(input)).rejects.toThrow(
      /Primary \(ollama\) and fallback \(gemini\) failed.*GEMINI_API_KEY is not set/,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("ProviderRouter with a real OllamaProvider", () => {
  class MockGemini implements LLMProvider {
    readonly chat = vi.fn<(input: LLMChatInput) => Promise<LLMChatResult>>();
  }

  it.each([
    ["unreachable", () => Promise.reject(new TypeError("fetch failed"))],
    ["rejecting the key", () => Promise.resolve({ ok: false, status: 401, text: async () => "unauthorized" })],
  ])("falls back from Ollama to Gemini when the remote server is %s", async (_case, impl) => {
    const gemini = new MockGemini();
    gemini.chat.mockResolvedValue({ provider: "gemini", assistantMessage: { role: "assistant", content: "from gemini" } });
    const router = new ProviderRouter(
      {
        name: "ollama",
        provider: new OllamaProvider({
          baseUrl: "https://ollama.example.com",
          model: "qwen3:8b",
          apiKey: OLLAMA_KEY,
          fetchImpl: vi.fn(impl) as never,
        }),
      },
      { name: "gemini", provider: gemini },
    );

    const result = await router.chat(input);

    expect(result.provider).toBe("gemini");
    expect(result.assistantMessage.content).toBe("from gemini");
    expect(gemini.chat).toHaveBeenCalledWith(input);
  });
});

describe("chat flows on an Ollama primary", () => {
  let db: Db | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  function stack() {
    const dir = mkdtempSync(join(tmpdir(), "andru-ollama-"));
    db = openDb(join(dir, "test.db"));
    return { db, gateway: new Gateway(createRegistry(new SimulatedAdapter(db))) };
  }

  it("keeps the fast device path: action first, then one tool-free Ollama call", async () => {
    const { db, gateway } = stack();
    const fetchMock = stubFetch(async () => ollamaReply("The bedroom AC is now off."));
    const provider = createLLMProvider(loadConfig(REMOTE_ENV));

    const result = await runChat({ message: "Turn off the bedroom AC", provider, gateway, db });

    expect(result.reply).toBe("The bedroom AC is now off.");
    expect(result.toolTrace.map((t) => t.name)).toEqual(["set_ac"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(request(fetchMock).body).not.toHaveProperty("tools");
  });

  it("sends tools for normal requests", async () => {
    const { db, gateway } = stack();
    const fetchMock = stubFetch(async () => ollamaReply("Hello!"));
    const provider = createLLMProvider(loadConfig(REMOTE_ENV));

    const result = await runChat({ message: "Hello there", provider, gateway, db });

    expect(result.reply).toBe("Hello!");
    expect((request(fetchMock).body.tools as unknown[]).length).toBe(toolDefinitions.length);
  });
});
