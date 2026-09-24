import { describe, expect, it } from "vitest";
import {
  canClaimPlaying,
  enableAudioFailureReply,
  interpretPlayAttempt,
  planEnableAudioUnlock,
  playbackUiLabel,
  reconcileAssistantReply,
  truthfulPlaybackReply,
  youtubeWatchUrl,
  YT_PLAYER_STATE,
} from "../src/youtube/playbackTruth.js";
import { resetYoutubeSession } from "../src/youtube/session.js";
import { executeYoutubeTool } from "../src/youtube/tools.js";

describe("YouTube playback truthfulness", () => {
  it("youtube_play returns queued — not confirmed playing", async () => {
    resetYoutubeSession("truth-play");
    const result = (await executeYoutubeTool(
      "youtube_play",
      { videoId: "dQw4w9WgXcQ", title: "Demo" },
      { sessionId: "truth-play", youtubeApiKey: "" },
    )) as { playbackStatus: string; note: string };

    expect(result.playbackStatus).toBe("queued");
    expect(result.note).toMatch(/Do NOT tell the user the video is already playing/i);
    expect(canClaimPlaying("queued")).toBe(false);
  });

  it("play success may claim playing; blocked/not-ready/error must not", () => {
    expect(canClaimPlaying("playing")).toBe(true);
    expect(canClaimPlaying("autoplay_blocked")).toBe(false);
    expect(canClaimPlaying("player_not_ready")).toBe(false);
    expect(canClaimPlaying("player_error")).toBe(false);
    expect(canClaimPlaying("queued")).toBe(false);
  });

  it("interpretPlayAttempt covers ready / blocked / error / not ready", () => {
    expect(
      interpretPlayAttempt({
        playerReady: false,
        observedState: null,
        hadError: false,
      }),
    ).toBe("player_not_ready");

    expect(
      interpretPlayAttempt({
        playerReady: true,
        observedState: YT_PLAYER_STATE.PLAYING,
        hadError: false,
      }),
    ).toBe("playing");

    expect(
      interpretPlayAttempt({
        playerReady: true,
        observedState: YT_PLAYER_STATE.CUED,
        hadError: false,
      }),
    ).toBe("autoplay_blocked");

    expect(
      interpretPlayAttempt({
        playerReady: true,
        observedState: YT_PLAYER_STATE.PAUSED,
        hadError: true,
      }),
    ).toBe("player_error");
  });

  it("reconcileAssistantReply replaces false playing claims", () => {
    const llm = "Tum Hi Ho is playing now on YouTube!";
    expect(
      reconcileAssistantReply(llm, [
        { action: "play", status: "autoplay_blocked", title: "Tum Hi Ho" },
      ]),
    ).toMatch(/blocked autoplay/i);

    expect(
      reconcileAssistantReply(llm, [
        { action: "play", status: "player_not_ready", title: "Tum Hi Ho" },
      ]),
    ).toMatch(/still loading/i);

    expect(
      reconcileAssistantReply(llm, [
        { action: "play", status: "player_error", title: "Tum Hi Ho" },
      ]),
    ).toMatch(/couldn't play|error/i);

    expect(
      reconcileAssistantReply(llm, [
        { action: "play", status: "playing", title: "Tum Hi Ho" },
      ]),
    ).toMatch(/Playing Tum Hi Ho/i);
  });

  it("successful retry after enable uses playing message", () => {
    expect(truthfulPlaybackReply("playing", "Tum Hi Ho")).toMatch(/Playing Tum Hi Ho/);
    expect(playbackUiLabel("autoplay_blocked", "Tum Hi Ho")).toMatch(/Audio blocked/i);
    expect(playbackUiLabel("playing", "Tum Hi Ho")).toMatch(/^Playing:/);
    expect(playbackUiLabel("player_not_ready")).toMatch(/Loading YouTube/);
  });

  it("planEnableAudioUnlock: queued video + ready → play_now", () => {
    expect(
      planEnableAudioUnlock({
        playerReady: true,
        queuedVideoId: "dQw4w9WgXcQ",
      }),
    ).toEqual({ action: "play_now", videoId: "dQw4w9WgXcQ" });
  });

  it("planEnableAudioUnlock: autoplay blocked still has queued id for retry", () => {
    const plan = planEnableAudioUnlock({
      playerReady: true,
      queuedVideoId: "abcdefghijk",
      pendingPlayVideoId: null,
    });
    expect(plan).toEqual({ action: "play_now", videoId: "abcdefghijk" });
    expect(youtubeWatchUrl("abcdefghijk")).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk",
    );
  });

  it("planEnableAudioUnlock: player not ready keeps video pending", () => {
    expect(
      planEnableAudioUnlock({
        playerReady: false,
        queuedVideoId: "dQw4w9WgXcQ",
      }),
    ).toEqual({ action: "wait_for_ready", videoId: "dQw4w9WgXcQ" });
    expect(enableAudioFailureReply("player_not_ready")).toMatch(/still loading/i);
  });

  it("planEnableAudioUnlock: no-video enable click", () => {
    expect(
      planEnableAudioUnlock({
        playerReady: true,
        queuedVideoId: null,
      }),
    ).toEqual({ action: "no_video" });
    expect(enableAudioFailureReply("no_video")).toMatch(/no queued/i);
    expect(youtubeWatchUrl("bad")).toBeNull();
  });

  it("BUFFERING is not treated as terminal autoplay block", () => {
    expect(
      interpretPlayAttempt({
        playerReady: true,
        observedState: YT_PLAYER_STATE.BUFFERING,
        hadError: false,
      }),
    ).toBe("queued");
  });

  it("device-only outcomes leave LLM reply unchanged", () => {
    expect(
      reconcileAssistantReply("AC is on.", [
        { action: "pause", status: "paused" },
      ]),
    ).toBe("AC is on.");
  });
});
