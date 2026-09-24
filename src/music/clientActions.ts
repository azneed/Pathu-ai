import { z } from "zod";

/** Audius track ids are opaque alphanumeric ids (not URLs). */
export const audiusTrackIdSchema = z
  .string()
  .trim()
  .regex(
    /^[a-zA-Z0-9]{4,64}$/,
    "trackId must be an Audius track id (not a URL)",
  );

export const MUSIC_ACTIONS = [
  "play",
  "pause",
  "resume",
  "stop",
  "next",
  "previous",
  "set_volume",
] as const;

const musicBase = z.object({ type: z.literal("music") });

/** Relative same-origin stream path only — never arbitrary remote URLs from the LLM. */
export const musicStreamPathSchema = z
  .string()
  .trim()
  .regex(
    /^\/music\/stream\/[a-zA-Z0-9]{4,64}$/,
    "streamPath must be a same-origin /music/stream/{trackId} path",
  );

export const musicClientActionSchema = z.discriminatedUnion("action", [
  musicBase.extend({
    action: z.literal("play"),
    trackId: audiusTrackIdSchema,
    streamPath: musicStreamPathSchema,
    title: z.string().optional(),
    artist: z.string().optional(),
  }),
  musicBase.extend({ action: z.literal("pause") }),
  musicBase.extend({ action: z.literal("resume") }),
  musicBase.extend({ action: z.literal("stop") }),
  musicBase.extend({ action: z.literal("next") }),
  musicBase.extend({ action: z.literal("previous") }),
  musicBase.extend({
    action: z.literal("set_volume"),
    volume: z.number().int().min(0).max(100),
  }),
]);

export type MusicClientAction = z.infer<typeof musicClientActionSchema>;

export function parseMusicClientAction(value: unknown): MusicClientAction {
  return musicClientActionSchema.parse(value);
}
