import { z } from "zod";
import type { ToolDefinition } from "../ai/types.js";
import {
  parseClientAction,
  youtubeVideoIdSchema,
  type ClientAction,
} from "./clientActions.js";
import { searchYoutubeVideos } from "./search.js";
import {
  getYoutubeSession,
  rememberPlay,
  rememberSearchResults,
  snapshotYoutubeSession,
} from "./session.js";

const searchSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    maxResults: z.number().int().min(1).max(5).optional(),
  })
  .strict();

const playSchema = z
  .object({
    videoId: youtubeVideoIdSchema,
    title: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

const volumeSchema = z
  .object({
    volume: z.number().int().min(0).max(100),
  })
  .strict();

const emptySchema = z.object({}).strict();

export const youtubeToolDefinitions: ToolDefinition[] = [
  {
    name: "youtube_search",
    description:
      "Search YouTube for videos only (YouTube Data API). Returns a short list of videoId/title/channelTitle. Use before youtube_play. Does not play audio by itself. Not for websites, apps, or OS control.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          description: "Number of results (1-5, default 5)",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "youtube_play",
    description:
      "Queue a YouTube video in the embedded /voice player by videoId only (11-char id from youtube_search). Never pass URLs. Returns playbackStatus=queued and a clientAction — the browser confirms real playback. NEVER tell the user it is already playing from this tool alone.",
    parameters: {
      type: "object",
      properties: {
        videoId: {
          type: "string",
          description: "YouTube video id (11 characters, not a URL)",
        },
        title: {
          type: "string",
          description: "Optional title for display/context",
        },
      },
      required: ["videoId"],
      additionalProperties: false,
    },
  },
  {
    name: "youtube_pause",
    description: "Pause the embedded YouTube player.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "youtube_resume",
    description: "Resume playback on the embedded YouTube player.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "youtube_stop",
    description: "Stop the embedded YouTube player.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "youtube_next",
    description:
      "Play the next video in the current YouTube search/playlist context. Fails clearly if none.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "youtube_previous",
    description:
      "Play the previous video in the current YouTube search/playlist context. Fails clearly if none.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "youtube_set_volume",
    description: "Set embedded YouTube player volume to an integer 0-100.",
    parameters: {
      type: "object",
      properties: {
        volume: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["volume"],
      additionalProperties: false,
    },
  },
];

export const YOUTUBE_TOOL_NAMES = youtubeToolDefinitions.map((t) => t.name);

export interface YoutubeToolContext {
  sessionId: string;
  youtubeApiKey: string;
  fetchImpl?: typeof fetch;
}

export async function executeYoutubeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: YoutubeToolContext,
): Promise<unknown> {
  switch (name) {
    case "youtube_search": {
      const parsed = searchSchema.parse(args);
      const results = await searchYoutubeVideos({
        apiKey: ctx.youtubeApiKey,
        query: parsed.query,
        maxResults: parsed.maxResults ?? 5,
        fetchImpl: ctx.fetchImpl,
      });
      rememberSearchResults(ctx.sessionId, results);
      return {
        ok: true,
        results,
        count: results.length,
        note:
          results.length === 0
            ? "No videos found."
            : "Pick a videoId and call youtube_play. Do not invent ids.",
      };
    }

    case "youtube_play": {
      const parsed = playSchema.parse(args);
      // Extra guard: reject anything that looks like a URL scheme even if regex somehow bypassed.
      if (/[:/\\]/.test(parsed.videoId) || /^(javascript|https?|file)/i.test(parsed.videoId)) {
        throw new Error("Only plain YouTube video ids are allowed");
      }
      rememberPlay(ctx.sessionId, parsed.videoId, parsed.title);
      const clientAction = parseClientAction({
        type: "youtube",
        action: "play",
        videoId: parsed.videoId,
        title: parsed.title,
      });
      return {
        ok: true,
        playbackStatus: "queued",
        clientAction,
        note:
          "Queued a play clientAction for the /voice YouTube player only. " +
          "Do NOT tell the user the video is already playing. " +
          "Say you queued/sent it to the player; Chrome may require tapping Enable YouTube audio.",
        playerHint: snapshotYoutubeSession(ctx.sessionId),
      };
    }

    case "youtube_pause": {
      emptySchema.parse(args);
      const state = getYoutubeSession(ctx.sessionId);
      state.status = "paused";
      return {
        ok: true,
        clientAction: parseClientAction({ type: "youtube", action: "pause" }),
        playerHint: snapshotYoutubeSession(ctx.sessionId),
      };
    }

    case "youtube_resume": {
      emptySchema.parse(args);
      const state = getYoutubeSession(ctx.sessionId);
      state.status = "playing";
      return {
        ok: true,
        clientAction: parseClientAction({ type: "youtube", action: "resume" }),
        playerHint: snapshotYoutubeSession(ctx.sessionId),
      };
    }

    case "youtube_stop": {
      emptySchema.parse(args);
      const state = getYoutubeSession(ctx.sessionId);
      state.status = "stopped";
      return {
        ok: true,
        clientAction: parseClientAction({ type: "youtube", action: "stop" }),
        playerHint: snapshotYoutubeSession(ctx.sessionId),
      };
    }

    case "youtube_next": {
      emptySchema.parse(args);
      const state = getYoutubeSession(ctx.sessionId);
      if (state.playlist.length === 0 || state.currentIndex < 0) {
        throw new Error(
          "Next video is not available in the current playback context. Search and play a video first.",
        );
      }
      if (state.currentIndex >= state.playlist.length - 1) {
        throw new Error("Already at the last video in the current playlist.");
      }
      const nextIndex = state.currentIndex + 1;
      const videoId = state.playlist[nextIndex]!;
      const title = state.lastResults.find((r) => r.videoId === videoId)?.title;
      rememberPlay(ctx.sessionId, videoId, title);
      return {
        ok: true,
        playbackStatus: "queued",
        clientAction: parseClientAction({
          type: "youtube",
          action: "play",
          videoId,
          title,
        }),
        note:
          "Queued next playlist item. Do NOT claim it is already playing until the browser confirms.",
        playerHint: snapshotYoutubeSession(ctx.sessionId),
      };
    }

    case "youtube_previous": {
      emptySchema.parse(args);
      const state = getYoutubeSession(ctx.sessionId);
      if (state.playlist.length === 0 || state.currentIndex < 0) {
        throw new Error(
          "Previous video is not available in the current playback context. Search and play a video first.",
        );
      }
      if (state.currentIndex <= 0) {
        throw new Error("Already at the first video in the current playlist.");
      }
      const prevIndex = state.currentIndex - 1;
      const videoId = state.playlist[prevIndex]!;
      const title = state.lastResults.find((r) => r.videoId === videoId)?.title;
      rememberPlay(ctx.sessionId, videoId, title);
      return {
        ok: true,
        playbackStatus: "queued",
        clientAction: parseClientAction({
          type: "youtube",
          action: "play",
          videoId,
          title,
        }),
        note:
          "Queued previous playlist item. Do NOT claim it is already playing until the browser confirms.",
        playerHint: snapshotYoutubeSession(ctx.sessionId),
      };
    }

    case "youtube_set_volume": {
      const parsed = volumeSchema.parse(args);
      const state = getYoutubeSession(ctx.sessionId);
      state.volume = parsed.volume;
      return {
        ok: true,
        clientAction: parseClientAction({
          type: "youtube",
          action: "set_volume",
          volume: parsed.volume,
        }),
        playerHint: snapshotYoutubeSession(ctx.sessionId),
      };
    }

    default:
      throw new Error(`Unknown YouTube tool: ${name}`);
  }
}
