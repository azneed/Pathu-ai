/**
 * Shared playback-status vocabulary for server tool results and /voice UI.
 * Browser player remains authoritative for actual audio.
 */

export const PLAYBACK_STATUSES = [
  "queued",
  "player_not_ready",
  "autoplay_blocked",
  "playing",
  "paused",
  "stopped",
  "player_error",
  "accepted",
] as const;

export type PlaybackStatus = (typeof PLAYBACK_STATUSES)[number];

export function canClaimPlaying(status: PlaybackStatus): boolean {
  return status === "playing";
}

/** User-facing line for the YouTube meta strip. */
export function playbackUiLabel(
  status: PlaybackStatus,
  title?: string,
): string {
  const t = title?.trim();
  switch (status) {
    case "queued":
      return t ? `Loading: ${t}` : "Loading YouTube…";
    case "player_not_ready":
      return "Loading YouTube…";
    case "autoplay_blocked":
      return t
        ? `Audio blocked — enable audio (${t})`
        : "Audio blocked — enable audio";
    case "playing":
      return t ? `Playing: ${t}` : "Playing";
    case "paused":
      return t ? `Paused: ${t}` : "Paused";
    case "stopped":
      return t ? `Stopped: ${t}` : "Stopped";
    case "player_error":
      return t ? `YouTube error (${t})` : "YouTube player error";
    case "accepted":
      return t ? `Ready: ${t}` : "Ready";
    default:
      return "Ready";
  }
}

/** Spoken / reply text when the browser knows the real outcome. */
export function truthfulPlaybackReply(
  status: PlaybackStatus,
  title?: string,
): string {
  const t = title?.trim();
  switch (status) {
    case "playing":
      return t ? `Playing ${t} on YouTube.` : "Playing on YouTube.";
    case "autoplay_blocked":
      return t
        ? `I queued ${t}, but the browser blocked autoplay. Tap Enable YouTube audio on the voice page, then I can play it.`
        : "I queued the video, but the browser blocked autoplay. Tap Enable YouTube audio on the voice page.";
    case "player_not_ready":
      return t
        ? `I queued ${t}, but the YouTube player is still loading. Tap Enable YouTube audio if it appears, or try again in a moment.`
        : "I queued the video, but the YouTube player is still loading. Try again in a moment.";
    case "player_error":
      return t
        ? `I couldn't play ${t} — the YouTube player reported an error.`
        : "I couldn't play that — the YouTube player reported an error.";
    case "paused":
      return t ? `Paused ${t}.` : "Paused YouTube.";
    case "stopped":
      return t ? `Stopped ${t}.` : "Stopped YouTube.";
    case "queued":
      return t
        ? `Queued ${t} for the YouTube player. It is not confirmed playing yet.`
        : "Queued for the YouTube player. It is not confirmed playing yet.";
    default:
      return "YouTube player updated.";
  }
}

/**
 * If client outcomes include a play that did not reach "playing",
 * replace a premature "it's playing" LLM reply with a truthful one.
 */
export function reconcileAssistantReply(
  llmReply: string,
  outcomes: Array<{ action: string; status: PlaybackStatus; title?: string }>,
): string {
  const playOutcomes = outcomes.filter((o) => o.action === "play");
  if (playOutcomes.length === 0) return llmReply;

  const worst =
    playOutcomes.find((o) => o.status === "player_error") ??
    playOutcomes.find((o) => o.status === "autoplay_blocked") ??
    playOutcomes.find((o) => o.status === "player_not_ready") ??
    playOutcomes.find((o) => o.status === "queued") ??
    playOutcomes[playOutcomes.length - 1]!;

  if (canClaimPlaying(worst.status)) {
    // Prefer a confirmed playing line over a vague LLM claim.
    return truthfulPlaybackReply("playing", worst.title);
  }

  return truthfulPlaybackReply(worst.status, worst.title);
}

/** YT.PlayerState numbers used by the IFrame API. */
export const YT_PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

/**
 * After loadVideoById / playVideo, interpret observed player state.
 * If still not PLAYING after the wait window → autoplay_blocked (when ready).
 * BUFFERING is treated as still in-progress (caller should keep waiting).
 */
export function interpretPlayAttempt(options: {
  playerReady: boolean;
  observedState: number | null;
  hadError: boolean;
}): PlaybackStatus {
  if (options.hadError) return "player_error";
  if (!options.playerReady) return "player_not_ready";
  if (options.observedState === YT_PLAYER_STATE.PLAYING) return "playing";
  if (options.observedState === YT_PLAYER_STATE.BUFFERING) {
    // Not terminal — still trying.
    return "queued";
  }
  return "autoplay_blocked";
}

export type EnableAudioPlan =
  | { action: "play_now"; videoId: string }
  | { action: "wait_for_ready"; videoId: string }
  | { action: "no_video" };

/**
 * Decide what the Enable YouTube audio click should do.
 * playVideo must run in the same user-gesture turn when action is play_now.
 */
export function planEnableAudioUnlock(options: {
  playerReady: boolean;
  queuedVideoId: string | null | undefined;
  pendingPlayVideoId?: string | null;
}): EnableAudioPlan {
  const videoId =
    (options.queuedVideoId && options.queuedVideoId.trim()) ||
    (options.pendingPlayVideoId && options.pendingPlayVideoId.trim()) ||
    "";
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return { action: "no_video" };
  }
  if (!options.playerReady) {
    return { action: "wait_for_ready", videoId };
  }
  return { action: "play_now", videoId };
}

/** Safe watch URL for a validated video id only. */
export function youtubeWatchUrl(videoId: string): string | null {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function enableAudioFailureReply(
  reason: "no_video" | "still_blocked" | "player_not_ready" | "player_error",
  title?: string,
): string {
  const t = title?.trim();
  switch (reason) {
    case "no_video":
      return "There is no queued YouTube video to unlock. Ask me to play something first.";
    case "player_not_ready":
      return "The YouTube player is still loading. When it says Ready, tap Enable YouTube audio again.";
    case "still_blocked":
      return t
        ? `Chrome still blocked playback of ${t}. Tap Enable YouTube audio again, or use Watch on YouTube.`
        : "Chrome still blocked playback. Tap Enable YouTube audio again, or use Watch on YouTube.";
    case "player_error":
      return t
        ? `Could not start ${t}. Try Watch on YouTube, or ask me to play again.`
        : "Could not start YouTube playback. Try Watch on YouTube, or ask me to play again.";
  }
}
