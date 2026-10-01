export type VoicePhase =
  | "idle"
  | "wake_listening"
  | "command_listening"
  | "processing"
  | "speaking"
  | "error";

export type VoiceUiLabel =
  | "Say Hey Pathu"
  | "Listening..."
  | "Thinking..."
  | "Speaking..."
  | "Error";

export type VoiceDiagEvent = {
  at: number;
  message: string;
};

export type VoiceConversationStatus = {
  phase: VoicePhase;
  uiLabel: VoiceUiLabel;
  partialTranscript: string;
  transcript: string | null;
  reply: string | null;
  error: string | null;
  sttMode: "on-device" | "system" | "unknown";
  sessionId: number;
  diagnostics: VoiceDiagEvent[];
};

export function phaseToLabel(phase: VoicePhase): VoiceUiLabel {
  switch (phase) {
    case "wake_listening":
    case "idle":
      return "Say Hey Pathu";
    case "command_listening":
      return "Listening...";
    case "processing":
      return "Thinking...";
    case "speaking":
      return "Speaking...";
    case "error":
      return "Error";
  }
}
