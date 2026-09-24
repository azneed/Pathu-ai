import { describe, expect, it } from "vitest";
import { executeTool, toolDefinitions } from "../src/ai/tools.js";
import {
  clientActionSchema,
  parseClientAction,
  youtubeVideoIdSchema,
} from "../src/youtube/clientActions.js";
import { searchYoutubeVideos } from "../src/youtube/search.js";
import { resetYoutubeSession } from "../src/youtube/session.js";
import { executeYoutubeTool } from "../src/youtube/tools.js";

describe("YouTube security boundary", () => {
  it("exposes only youtube_* media tools — no shell/browser automation tools", () => {
    const names = toolDefinitions.map((t) => t.name);
    expect(names).toContain("youtube_search");
    expect(names).toContain("youtube_play");
    expect(names).toContain("youtube_pause");
    expect(names).not.toContain("browser_click");
    expect(names).not.toContain("browser_navigate");
    expect(names).not.toContain("shell");
    expect(names).not.toContain("run_command");
    expect(names).not.toContain("computer_control");
    expect(names).not.toContain("open_url");
  });

  it("youtube_search only accepts query strings", async () => {
    await expect(
      executeYoutubeTool(
        "youtube_search",
        { query: "" },
        { sessionId: "t1", youtubeApiKey: "k" },
      ),
    ).rejects.toThrow();

    await expect(
      executeYoutubeTool(
        "youtube_search",
        { query: "ok", shell: "rm -rf /" },
        { sessionId: "t1", youtubeApiKey: "k" },
      ),
    ).rejects.toThrow();
  });

  it("youtube_play rejects URLs and invalid ids", async () => {
    resetYoutubeSession("sec");
    await expect(
      executeYoutubeTool(
        "youtube_play",
        { videoId: "https://youtube.com/watch?v=dQw4w9WgXcQ" },
        { sessionId: "sec", youtubeApiKey: "" },
      ),
    ).rejects.toThrow();

    await expect(
      executeYoutubeTool(
        "youtube_play",
        { videoId: "javascript:alert(1)" },
        { sessionId: "sec", youtubeApiKey: "" },
      ),
    ).rejects.toThrow();

    await expect(
      executeYoutubeTool(
        "youtube_play",
        { videoId: "file:///etc/passwd" },
        { sessionId: "sec", youtubeApiKey: "" },
      ),
    ).rejects.toThrow();

    await expect(
      executeYoutubeTool(
        "youtube_play",
        { videoId: "short" },
        { sessionId: "sec", youtubeApiKey: "" },
      ),
    ).rejects.toThrow();
  });

  it("youtube_play accepts a valid video id and emits typed clientAction", async () => {
    resetYoutubeSession("sec-play");
    const result = (await executeYoutubeTool(
      "youtube_play",
      { videoId: "dQw4w9WgXcQ", title: "Test" },
      { sessionId: "sec-play", youtubeApiKey: "" },
    )) as { clientAction: unknown; playbackStatus: string };

    expect(result.playbackStatus).toBe("queued");
    expect(parseClientAction(result.clientAction)).toEqual({
      type: "youtube",
      action: "play",
      videoId: "dQw4w9WgXcQ",
      title: "Test",
    });
  });

  it("volume is limited to 0-100", async () => {
    await expect(
      executeYoutubeTool(
        "youtube_set_volume",
        { volume: 150 },
        { sessionId: "sec-vol", youtubeApiKey: "" },
      ),
    ).rejects.toThrow();

    await expect(
      executeYoutubeTool(
        "youtube_set_volume",
        { volume: -1 },
        { sessionId: "sec-vol", youtubeApiKey: "" },
      ),
    ).rejects.toThrow();

    const ok = (await executeYoutubeTool(
      "youtube_set_volume",
      { volume: 30 },
      { sessionId: "sec-vol", youtubeApiKey: "" },
    )) as { clientAction: { volume: number } };
    expect(ok.clientAction.volume).toBe(30);
  });

  it("rejects unknown clientAction types and actions", () => {
    expect(() =>
      parseClientAction({ type: "browser", action: "navigate", url: "https://example.com" }),
    ).toThrow();
    expect(() =>
      parseClientAction({ type: "youtube", action: "execute", code: "alert(1)" }),
    ).toThrow();
    expect(() =>
      parseClientAction({ type: "shell", action: "run", command: "powershell" }),
    ).toThrow();
    expect(clientActionSchema.safeParse({ type: "youtube", action: "play" }).success).toBe(
      false,
    );
  });

  it("videoId schema rejects URL-like values", () => {
    expect(youtubeVideoIdSchema.safeParse("https://x").success).toBe(false);
    expect(youtubeVideoIdSchema.safeParse("dQw4w9WgXcQ").success).toBe(true);
  });

  it("search fails gracefully without API key", async () => {
    await expect(
      searchYoutubeVideos({ apiKey: "", query: "nasa", maxResults: 3 }),
    ).rejects.toThrow(/not configured/i);
  });

  it("search uses mocked fetch and returns trimmed results", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              id: { videoId: "abcdefghijk" },
              snippet: {
                title: "NASA Doc",
                channelTitle: "NASA",
                publishedAt: "2020-01-01T00:00:00Z",
              },
            },
            {
              id: { kind: "youtube#channel" },
              snippet: { title: "Channel only" },
            },
          ],
        }),
        { status: 200 },
      );

    const results = await searchYoutubeVideos({
      apiKey: "test-key",
      query: "NASA documentary",
      maxResults: 5,
      fetchImpl,
    });
    expect(results).toEqual([
      {
        videoId: "abcdefghijk",
        title: "NASA Doc",
        channelTitle: "NASA",
        publishedAt: "2020-01-01T00:00:00Z",
      },
    ]);
  });

  it("next/previous require playlist context", async () => {
    resetYoutubeSession("sec-nav");
    await expect(
      executeYoutubeTool("youtube_next", {}, { sessionId: "sec-nav", youtubeApiKey: "" }),
    ).rejects.toThrow(/not available/i);
  });

  it("executeTool routes youtube tools without device gateway side effects", async () => {
    resetYoutubeSession("via-exec");
    const result = await executeTool(
      "youtube_pause",
      {},
      {
        gateway: {
          get: () => {
            throw new Error("should not touch gateway");
          },
          set: () => {
            throw new Error("should not touch gateway");
          },
          getAll: () => ({} as never),
        },
        tasks: null as never,
        timeZone: "UTC",
        sessionId: "via-exec",
        youtubeApiKey: "",
      },
    );
    expect(result).toMatchObject({
      ok: true,
      clientAction: { type: "youtube", action: "pause" },
    });
  });
});
