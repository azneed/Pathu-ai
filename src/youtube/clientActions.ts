import { z } from "zod";
import {
  musicClientActionSchema,
  type MusicClientAction,
} from "../music/clientActions.js";

/** Official YouTube video IDs are 11 URL-safe characters. */
export const youtubeVideoIdSchema = z
  .string()
  .trim()
  .regex(
    /^[a-zA-Z0-9_-]{11}$/,
    "videoId must be an 11-character YouTube video id (not a URL)",
  );

export const YOUTUBE_ACTIONS = [
  "play",
  "pause",
  "resume",
  "stop",
  "next",
  "previous",
  "set_volume",
] as const;

export type YoutubeAction = (typeof YOUTUBE_ACTIONS)[number];

const youtubeClientActionBase = z.object({
  type: z.literal("youtube"),
});

export const youtubeClientActionSchema = z.discriminatedUnion("action", [
  youtubeClientActionBase.extend({
    action: z.literal("play"),
    videoId: youtubeVideoIdSchema,
    title: z.string().optional(),
  }),
  youtubeClientActionBase.extend({
    action: z.literal("pause"),
  }),
  youtubeClientActionBase.extend({
    action: z.literal("resume"),
  }),
  youtubeClientActionBase.extend({
    action: z.literal("stop"),
  }),
  youtubeClientActionBase.extend({
    action: z.literal("next"),
  }),
  youtubeClientActionBase.extend({
    action: z.literal("previous"),
  }),
  youtubeClientActionBase.extend({
    action: z.literal("set_volume"),
    volume: z.number().int().min(0).max(100),
  }),
]);

export type YoutubeClientAction = z.infer<typeof youtubeClientActionSchema>;

/** Strict allowlist: YouTube video player OR Audius music player only. */
export const clientActionSchema = z.union([
  youtubeClientActionSchema,
  musicClientActionSchema,
]);

export type ClientAction = YoutubeClientAction | MusicClientAction;

export function parseClientAction(value: unknown): ClientAction {
  return clientActionSchema.parse(value);
}

export function safeParseClientActions(values: unknown[]): ClientAction[] {
  const out: ClientAction[] = [];
  for (const value of values) {
    const parsed = clientActionSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Invalid clientAction rejected: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    out.push(parsed.data);
  }
  return out;
}
