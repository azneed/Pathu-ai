export type WakeWordState =
  | "idle"
  | "initializing"
  | "listening"
  | "detected"
  | "error";

export type WakeWordPermission = "unknown" | "granted" | "denied";

export type WakeDetectionEvent = {
  keyword: string;
  at: number;
  source: "microphone" | "wav-test";
};

/** Safe mic/KWS diagnostics (no raw audio). */
export type WakeAudioDiagnostics = {
  framesReceived: number;
  lastFrameBytes: number;
  lastFrameSamples: number;
  sampleRate: number;
  rms: number;
  peak: number;
  kwsAccepts: number;
  kwsStreamActive: boolean;
  lastKwsKeyword: string;
  bufferSamples: number;
};

export type WakeWordStatus = {
  state: WakeWordState;
  permission: WakeWordPermission;
  error: string | null;
  detectionCount: number;
  lastDetection: WakeDetectionEvent | null;
  engine: string;
  audio: WakeAudioDiagnostics;
};
