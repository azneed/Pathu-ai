export interface AudiusTrackResult {
  trackId: string;
  title: string;
  artist: string;
  duration?: number;
  artworkUrl?: string;
  playable: boolean;
}

export interface MusicSessionState {
  lastResults: AudiusTrackResult[];
  playlist: string[];
  currentIndex: number;
  currentTrackId: string | null;
  currentTitle: string | null;
  currentArtist: string | null;
  volume: number;
  status: "idle" | "queued" | "playing" | "paused" | "stopped";
}

const sessions = new Map<string, MusicSessionState>();

function emptyState(): MusicSessionState {
  return {
    lastResults: [],
    playlist: [],
    currentIndex: -1,
    currentTrackId: null,
    currentTitle: null,
    currentArtist: null,
    volume: 80,
    status: "idle",
  };
}

export function getMusicSession(sessionId: string): MusicSessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = emptyState();
    sessions.set(sessionId, state);
  }
  return state;
}

export function resetMusicSession(sessionId: string): void {
  sessions.set(sessionId, emptyState());
}

export function rememberMusicSearch(
  sessionId: string,
  results: AudiusTrackResult[],
): void {
  const state = getMusicSession(sessionId);
  state.lastResults = results;
  state.playlist = results.map((r) => r.trackId);
}

export function rememberMusicPlay(
  sessionId: string,
  trackId: string,
  title?: string,
  artist?: string,
): void {
  const state = getMusicSession(sessionId);
  let index = state.playlist.indexOf(trackId);
  if (index < 0) {
    state.playlist = [trackId, ...state.playlist.filter((id) => id !== trackId)];
    index = 0;
  }
  state.currentIndex = index;
  state.currentTrackId = trackId;
  const fromSearch = state.lastResults.find((r) => r.trackId === trackId);
  state.currentTitle = title ?? fromSearch?.title ?? state.currentTitle;
  state.currentArtist = artist ?? fromSearch?.artist ?? state.currentArtist;
  state.status = "queued";
}

export function snapshotMusicSession(sessionId: string): MusicSessionState {
  return { ...getMusicSession(sessionId) };
}
