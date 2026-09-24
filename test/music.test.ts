import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executeTool, toolDefinitions } from "../src/ai/tools.js";
import {
  musicStreamPathFor,
  resolveAudiusStreamUrl,
  searchAudiusTracks,
} from "../src/music/audius.js";
import {
  audiusTrackIdSchema,
  musicClientActionSchema,
  parseMusicClientAction,
} from "../src/music/clientActions.js";
import { resetMusicSession } from "../src/music/session.js";
import { executeMusicTool } from "../src/music/tools.js";
import {
  clientActionSchema,
  parseClientAction,
} from "../src/youtube/clientActions.js";

const SAMPLE_TRACK_ID = "AbCdEfGhIjKlMn";

function mockStreamFetch(): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.includes("/stream")) {
      return new Response(JSON.stringify({ data: "https://cdn.example/stream.mp3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/tracks/search")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: SAMPLE_TRACK_ID,
              title: "Tum Hi Ho",
              user: { name: "Arijit" },
              duration: 240,
              artwork: { "150x150": "https://cdn.example/art.jpg" },
              is_streamable: true,
            },
            {
              id: "https://evil.example/x",
              title: "Bad",
              user: { name: "Nope" },
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  };
}

describe("Audius music security boundary", () => {
  it("exposes music_* tools and no shell/browser automation tools", () => {
    const names = toolDefinitions.map((t) => t.name);
    expect(names).toContain("music_search");
    expect(names).toContain("music_play");
    expect(names).toContain("music_pause");
    expect(names).toContain("music_set_volume");
    expect(names).toContain("youtube_search");
    expect(names).not.toContain("browser_click");
    expect(names).not.toContain("browser_navigate");
    expect(names).not.toContain("shell");
    expect(names).not.toContain("run_command");
    expect(names).not.toContain("computer_control");
    expect(names).not.toContain("media_control");
    expect(names).not.toContain("open_url");
  });

  it("music_search only accepts a valid query", async () => {
    await expect(
      executeMusicTool(
        "music_search",
        { query: "" },
        { sessionId: "m1", audiusApiKey: "k", fetchImpl: mockStreamFetch() },
      ),
    ).rejects.toThrow();

    await expect(
      executeMusicTool(
        "music_search",
        { query: "ok", shell: "rm -rf /" },
        { sessionId: "m1", audiusApiKey: "k", fetchImpl: mockStreamFetch() },
      ),
    ).rejects.toThrow();
  });

  it("music_play rejects URLs, javascript, and invalid ids", async () => {
    resetMusicSession("m-sec");
    await expect(
      executeMusicTool(
        "music_play",
        { trackId: "https://audius.co/track/1" },
        { sessionId: "m-sec", audiusApiKey: "k", fetchImpl: mockStreamFetch() },
      ),
    ).rejects.toThrow();

    await expect(
      executeMusicTool(
        "music_play",
        { trackId: "javascript:alert(1)" },
        { sessionId: "m-sec", audiusApiKey: "k", fetchImpl: mockStreamFetch() },
      ),
    ).rejects.toThrow();

    await expect(
      executeMusicTool(
        "music_play",
        { trackId: "file:///etc/passwd" },
        { sessionId: "m-sec", audiusApiKey: "k", fetchImpl: mockStreamFetch() },
      ),
    ).rejects.toThrow();

    await expect(
      executeMusicTool(
        "music_play",
        { trackId: "abc" },
        { sessionId: "m-sec", audiusApiKey: "k", fetchImpl: mockStreamFetch() },
      ),
    ).rejects.toThrow();
  });

  it("music_play accepts a valid track id and emits typed clientAction with streamPath", async () => {
    resetMusicSession("m-play");
    const result = (await executeMusicTool(
      "music_play",
      { trackId: SAMPLE_TRACK_ID, title: "Tum Hi Ho", artist: "Arijit" },
      { sessionId: "m-play", audiusApiKey: "test-key", fetchImpl: mockStreamFetch() },
    )) as { clientAction: unknown; playbackStatus: string };

    expect(result.playbackStatus).toBe("queued");
    expect(parseClientAction(result.clientAction)).toEqual({
      type: "music",
      action: "play",
      trackId: SAMPLE_TRACK_ID,
      streamPath: `/music/stream/${SAMPLE_TRACK_ID}`,
      title: "Tum Hi Ho",
      artist: "Arijit",
    });
  });

  it("volume is limited to 0-100", async () => {
    await expect(
      executeMusicTool(
        "music_set_volume",
        { volume: 150 },
        { sessionId: "m-vol", audiusApiKey: "k" },
      ),
    ).rejects.toThrow();

    await expect(
      executeMusicTool(
        "music_set_volume",
        { volume: -1 },
        { sessionId: "m-vol", audiusApiKey: "k" },
      ),
    ).rejects.toThrow();

    const ok = (await executeMusicTool(
      "music_set_volume",
      { volume: 30 },
      { sessionId: "m-vol", audiusApiKey: "k" },
    )) as { clientAction: { volume: number } };
    expect(ok.clientAction.volume).toBe(30);
  });

  it("rejects unknown music client actions and arbitrary URLs in play", () => {
    expect(() =>
      parseMusicClientAction({
        type: "music",
        action: "play",
        trackId: SAMPLE_TRACK_ID,
        streamPath: "https://evil.example/x.mp3",
      }),
    ).toThrow();

    expect(() =>
      parseMusicClientAction({
        type: "music",
        action: "execute",
        code: "alert(1)",
      }),
    ).toThrow();

    expect(() =>
      parseClientAction({
        type: "music",
        action: "play",
        trackId: SAMPLE_TRACK_ID,
        streamPath: "javascript:alert(1)",
      }),
    ).toThrow();

    expect(
      clientActionSchema.safeParse({
        type: "browser",
        action: "navigate",
        url: "https://example.com",
      }).success,
    ).toBe(false);

    expect(
      musicClientActionSchema.safeParse({
        type: "music",
        action: "set_volume",
        volume: 101,
      }).success,
    ).toBe(false);
  });

  it("trackId schema rejects URL-like values", () => {
    expect(audiusTrackIdSchema.safeParse("https://x").success).toBe(false);
    expect(audiusTrackIdSchema.safeParse(SAMPLE_TRACK_ID).success).toBe(true);
    expect(musicStreamPathFor(SAMPLE_TRACK_ID)).toBe(`/music/stream/${SAMPLE_TRACK_ID}`);
  });

  it("search fails gracefully without API key", async () => {
    await expect(
      searchAudiusTracks({ apiKey: "", query: "relax", maxResults: 3 }),
    ).rejects.toThrow(/not configured/i);
  });

  it("search uses mocked fetch and strips invalid ids", async () => {
    const results = await searchAudiusTracks({
      apiKey: "test-key",
      query: "Tum Hi Ho",
      maxResults: 5,
      fetchImpl: mockStreamFetch(),
    });
    expect(results).toEqual([
      {
        trackId: SAMPLE_TRACK_ID,
        title: "Tum Hi Ho",
        artist: "Arijit",
        duration: 240,
        artworkUrl: "https://cdn.example/art.jpg",
        playable: true,
      },
    ]);
  });

  it("resolveAudiusStreamUrl returns only https CDN urls", async () => {
    const url = await resolveAudiusStreamUrl({
      apiKey: "test-key",
      trackId: SAMPLE_TRACK_ID,
      fetchImpl: mockStreamFetch(),
    });
    expect(url).toBe("https://cdn.example/stream.mp3");
  });

  it("next/previous require playlist context", async () => {
    resetMusicSession("m-nav");
    await expect(
      executeMusicTool("music_next", {}, { sessionId: "m-nav", audiusApiKey: "k" }),
    ).rejects.toThrow(/not available/i);
  });

  it("executeTool routes music tools without device gateway side effects", async () => {
    resetMusicSession("via-music");
    const result = await executeTool(
      "music_pause",
      {},
      {
        gateway: {
          get: () => {
            throw new Error("should not touch gateway");
          },
          getAll: () => {
            throw new Error("should not touch gateway");
          },
          set: () => {
            throw new Error("should not touch gateway");
          },
        } as never,
        tasks: null as never,
        timeZone: "UTC",
        sessionId: "via-music",
        audiusApiKey: "k",
      },
    );
    expect((result as { clientAction: { type: string } }).clientAction.type).toBe("music");
  });

  it("voice.html never embeds an Audius API key", () => {
    const htmlPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../public/voice.html",
    );
    const html = readFileSync(htmlPath, "utf8");
    expect(html).not.toMatch(/AUDIUS_API_KEY/);
    expect(html).not.toMatch(/x-api-key/i);
    expect(html).toContain("/music/stream/");
    expect(html).toContain("Enable music audio");
    expect(html).toContain('id="musicAudio"');
  });
});
