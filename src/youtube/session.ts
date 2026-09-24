export interface YoutubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt?: string;
}

export interface YoutubeSessionState {
  lastResults: YoutubeSearchResult[];
  /** Ordered video ids available for next/previous (from last play/search). */
  playlist: string[];
  currentIndex: number;
  currentVideoId: string | null;
  currentTitle: string | null;
  volume: number;
  /** Approximate server-side hint; browser player is authoritative. */
  status: "idle" | "playing" | "paused" | "stopped";
}

const sessions = new Map<string, YoutubeSessionState>();

function emptyState(): YoutubeSessionState {
  return {
    lastResults: [],
    playlist: [],
    currentIndex: -1,
    currentVideoId: null,
    currentTitle: null,
    volume: 80,
    status: "idle",
  };
}

export function getYoutubeSession(sessionId: string): YoutubeSessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = emptyState();
    sessions.set(sessionId, state);
  }
  return state;
}

export function resetYoutubeSession(sessionId: string): void {
  sessions.set(sessionId, emptyState());
}

export function rememberSearchResults(
  sessionId: string,
  results: YoutubeSearchResult[],
): void {
  const state = getYoutubeSession(sessionId);
  state.lastResults = results;
  state.playlist = results.map((r) => r.videoId);
}

export function rememberPlay(
  sessionId: string,
  videoId: string,
  title?: string,
): void {
  const state = getYoutubeSession(sessionId);
  let index = state.playlist.indexOf(videoId);
  if (index < 0) {
    state.playlist = [videoId, ...state.playlist.filter((id) => id !== videoId)];
    index = 0;
  }
  state.currentIndex = index;
  state.currentVideoId = videoId;
  state.currentTitle =
    title ??
    state.lastResults.find((r) => r.videoId === videoId)?.title ??
    state.currentTitle;
  // Queued on server — browser confirms actual playing.
  state.status = "idle";
}

export function snapshotYoutubeSession(sessionId: string): YoutubeSessionState {
  return { ...getYoutubeSession(sessionId) };
}
