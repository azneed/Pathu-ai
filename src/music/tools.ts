import { z } from "zod";
import type { ToolDefinition } from "../ai/types.js";
import {
  musicStreamPathFor,
  resolveAudiusStreamUrl,
  searchAudiusTracks,
} from "./audius.js";
import {
  audiusTrackIdSchema,
  parseMusicClientAction,
  type MusicClientAction,
} from "./clientActions.js";
import {
  getMusicSession,
  rememberMusicPlay,
  rememberMusicSearch,
  snapshotMusicSession,
} from "./session.js";

const searchSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    maxResults: z.number().int().min(1).max(5).optional(),
  })
  .strict();

const playSchema = z
  .object({
    trackId: audiusTrackIdSchema,
    title: z.string().trim().min(1).max(300).optional(),
    artist: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

const volumeSchema = z
  .object({
    volume: z.number().int().min(0).max(100),
  })
  .strict();

const emptySchema = z.object({}).strict();

export const musicToolDefinitions: ToolDefinition[] = [
  {
    name: "music_search",
    description:
      "Search Audius for music tracks only. Returns trackId/title/artist. Use before music_play. Not for YouTube, websites, or OS control.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Music search query" },
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
    name: "music_play",
    description:
      "Queue an Audius track in the /voice audio player by trackId from music_search only. Never pass URLs. Returns playbackStatus=queued — do NOT claim the song is already playing.",
    parameters: {
      type: "object",
      properties: {
        trackId: {
          type: "string",
          description: "Audius track id from music_search (not a URL)",
        },
        title: { type: "string" },
        artist: { type: "string" },
      },
      required: ["trackId"],
      additionalProperties: false,
    },
  },
  {
    name: "music_pause",
    description: "Pause Audius music on the /voice audio player.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "music_resume",
    description: "Resume Audius music on the /voice audio player.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "music_stop",
    description: "Stop Audius music on the /voice audio player.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "music_next",
    description:
      "Play the next track in the current Audius search/playlist context.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "music_previous",
    description:
      "Play the previous track in the current Audius search/playlist context.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "music_set_volume",
    description: "Set Audius music volume to an integer 0-100.",
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

export const MUSIC_TOOL_NAMES = musicToolDefinitions.map((t) => t.name);

export interface MusicToolContext {
  sessionId: string;
  audiusApiKey: string;
  fetchImpl?: typeof fetch;
}

function playAction(
  trackId: string,
  title?: string,
  artist?: string,
): MusicClientAction {
  return parseMusicClientAction({
    type: "music",
    action: "play",
    trackId,
    streamPath: musicStreamPathFor(trackId),
    title,
    artist,
  });
}

export async function executeMusicTool(
  name: string,
  args: Record<string, unknown>,
  ctx: MusicToolContext,
): Promise<unknown> {
  switch (name) {
    case "music_search": {
      const parsed = searchSchema.parse(args);
      const results = await searchAudiusTracks({
        apiKey: ctx.audiusApiKey,
        query: parsed.query,
        maxResults: parsed.maxResults ?? 5,
        fetchImpl: ctx.fetchImpl,
      });
      rememberMusicSearch(ctx.sessionId, results);
      return {
        ok: true,
        results,
        count: results.length,
        note:
          results.length === 0
            ? "No Audius tracks found."
            : "Pick a trackId and call music_play. Do not invent ids or URLs.",
      };
    }

    case "music_play": {
      const parsed = playSchema.parse(args);
      if (/[:/\\]/.test(parsed.trackId) || /^(javascript|https?|file)/i.test(parsed.trackId)) {
        throw new Error("Only plain Audius track ids are allowed");
      }
      // Verify stream is resolvable before queuing (fails clearly if unavailable).
      await resolveAudiusStreamUrl({
        apiKey: ctx.audiusApiKey,
        trackId: parsed.trackId,
        fetchImpl: ctx.fetchImpl,
      });
      rememberMusicPlay(
        ctx.sessionId,
        parsed.trackId,
        parsed.title,
        parsed.artist,
      );
      return {
        ok: true,
        playbackStatus: "queued",
        clientAction: playAction(parsed.trackId, parsed.title, parsed.artist),
        note:
          "Queued Audius play for the /voice audio player. Do NOT say the song is already playing. " +
          "Browser autoplay may require Enable music audio.",
        playerHint: snapshotMusicSession(ctx.sessionId),
      };
    }

    case "music_pause": {
      emptySchema.parse(args);
      const state = getMusicSession(ctx.sessionId);
      state.status = "paused";
      return {
        ok: true,
        clientAction: parseMusicClientAction({ type: "music", action: "pause" }),
        playerHint: snapshotMusicSession(ctx.sessionId),
      };
    }

    case "music_resume": {
      emptySchema.parse(args);
      const state = getMusicSession(ctx.sessionId);
      state.status = "playing";
      return {
        ok: true,
        clientAction: parseMusicClientAction({ type: "music", action: "resume" }),
        playerHint: snapshotMusicSession(ctx.sessionId),
      };
    }

    case "music_stop": {
      emptySchema.parse(args);
      const state = getMusicSession(ctx.sessionId);
      state.status = "stopped";
      return {
        ok: true,
        clientAction: parseMusicClientAction({ type: "music", action: "stop" }),
        playerHint: snapshotMusicSession(ctx.sessionId),
      };
    }

    case "music_next": {
      emptySchema.parse(args);
      const state = getMusicSession(ctx.sessionId);
      if (state.playlist.length === 0 || state.currentIndex < 0) {
        throw new Error(
          "Next track is not available. Search and play an Audius track first.",
        );
      }
      if (state.currentIndex >= state.playlist.length - 1) {
        throw new Error("Already at the last track in the current playlist.");
      }
      const nextId = state.playlist[state.currentIndex + 1]!;
      const meta = state.lastResults.find((r) => r.trackId === nextId);
      await resolveAudiusStreamUrl({
        apiKey: ctx.audiusApiKey,
        trackId: nextId,
        fetchImpl: ctx.fetchImpl,
      });
      rememberMusicPlay(ctx.sessionId, nextId, meta?.title, meta?.artist);
      return {
        ok: true,
        playbackStatus: "queued",
        clientAction: playAction(nextId, meta?.title, meta?.artist),
        note: "Queued next Audius track. Do not claim it is already playing.",
        playerHint: snapshotMusicSession(ctx.sessionId),
      };
    }

    case "music_previous": {
      emptySchema.parse(args);
      const state = getMusicSession(ctx.sessionId);
      if (state.playlist.length === 0 || state.currentIndex < 0) {
        throw new Error(
          "Previous track is not available. Search and play an Audius track first.",
        );
      }
      if (state.currentIndex <= 0) {
        throw new Error("Already at the first track in the current playlist.");
      }
      const prevId = state.playlist[state.currentIndex - 1]!;
      const meta = state.lastResults.find((r) => r.trackId === prevId);
      await resolveAudiusStreamUrl({
        apiKey: ctx.audiusApiKey,
        trackId: prevId,
        fetchImpl: ctx.fetchImpl,
      });
      rememberMusicPlay(ctx.sessionId, prevId, meta?.title, meta?.artist);
      return {
        ok: true,
        playbackStatus: "queued",
        clientAction: playAction(prevId, meta?.title, meta?.artist),
        note: "Queued previous Audius track. Do not claim it is already playing.",
        playerHint: snapshotMusicSession(ctx.sessionId),
      };
    }

    case "music_set_volume": {
      const parsed = volumeSchema.parse(args);
      const state = getMusicSession(ctx.sessionId);
      state.volume = parsed.volume;
      return {
        ok: true,
        clientAction: parseMusicClientAction({
          type: "music",
          action: "set_volume",
          volume: parsed.volume,
        }),
        playerHint: snapshotMusicSession(ctx.sessionId),
      };
    }

    default:
      throw new Error(`Unknown music tool: ${name}`);
  }
}
