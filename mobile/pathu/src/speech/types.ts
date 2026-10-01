export type SpeechRecognitionState =
  | "idle"
  | "listening"
  | "recognized"
  | "error";

export type SpeechRecognitionMode = "on-device" | "system" | "unknown";

export type SpeechRecognitionStatus = {
  state: SpeechRecognitionState;
  partialTranscript: string;
  finalTranscript: string | null;
  error: string | null;
  mode: SpeechRecognitionMode;
  onDeviceAvailable: boolean;
};

export type SpeechTtsState = "idle" | "speaking" | "error";

export type SpeechTtsStatus = {
  state: SpeechTtsState;
  error: string | null;
};
