export const VOICE_STATES = [
  "IDLE",
  "LISTENING",
  "PROCESSING",
  "SPEAKING",
  "ERROR",
] as const;

export type VoiceState = (typeof VOICE_STATES)[number];

export type VoiceMode = "handsfree" | "pushtotalk";

export type VoiceEvent =
  | { type: "WAKE"; command?: string }
  | { type: "COMMAND_CAPTURED"; text: string }
  | { type: "PROCESS_STARTED" }
  | { type: "RESPONSE_READY" }
  | { type: "SPEAK_STARTED" }
  | { type: "SPEAK_ENDED" }
  | { type: "ERROR"; message?: string }
  | { type: "RECOVER" }
  | { type: "MODE_CHANGED"; mode: VoiceMode };

export interface VoiceMachineState {
  state: VoiceState;
  mode: VoiceMode;
  pendingCommand: string | null;
  lastError: string | null;
}

export function createVoiceMachineState(
  mode: VoiceMode = "handsfree",
): VoiceMachineState {
  return {
    state: "IDLE",
    mode,
    pendingCommand: null,
    lastError: null,
  };
}

/** Whether wake detection should be active. */
export function shouldRunWakeDetector(machine: VoiceMachineState): boolean {
  return machine.mode === "handsfree" && machine.state === "IDLE";
}

/** Whether a new command may be accepted. */
export function canAcceptCommand(machine: VoiceMachineState): boolean {
  return (
    machine.state === "IDLE" ||
    machine.state === "LISTENING" ||
    machine.state === "ERROR"
  );
}

export function reduceVoiceState(
  current: VoiceMachineState,
  event: VoiceEvent,
): VoiceMachineState {
  switch (event.type) {
    case "MODE_CHANGED":
      return {
        ...createVoiceMachineState(event.mode),
        mode: event.mode,
      };

    case "WAKE": {
      if (current.mode !== "handsfree") return current;
      if (current.state === "PROCESSING" || current.state === "SPEAKING") {
        return current;
      }
      const command = (event.command ?? "").trim();
      if (command) {
        return {
          ...current,
          state: "PROCESSING",
          pendingCommand: command,
          lastError: null,
        };
      }
      return {
        ...current,
        state: "LISTENING",
        pendingCommand: null,
        lastError: null,
      };
    }

    case "COMMAND_CAPTURED": {
      const text = event.text.trim();
      if (!text) return current;
      if (current.state !== "LISTENING" && current.mode === "handsfree") {
        // Push-to-talk / explicit send can jump to processing from IDLE
        if (current.state !== "IDLE" && current.state !== "ERROR") return current;
      }
      return {
        ...current,
        state: "PROCESSING",
        pendingCommand: text,
        lastError: null,
      };
    }

    case "PROCESS_STARTED":
      return { ...current, state: "PROCESSING", lastError: null };

    case "RESPONSE_READY":
    case "SPEAK_STARTED":
      if (current.state !== "PROCESSING" && current.state !== "SPEAKING") {
        return current;
      }
      return { ...current, state: "SPEAKING" };

    case "SPEAK_ENDED":
      return {
        ...current,
        state: "IDLE",
        pendingCommand: null,
        lastError: null,
      };

    case "ERROR":
      return {
        ...current,
        state: "ERROR",
        lastError: event.message ?? "Voice error",
        pendingCommand: null,
      };

    case "RECOVER":
      return {
        ...current,
        state: "IDLE",
        lastError: null,
        pendingCommand: null,
      };

    default:
      return current;
  }
}

export function statusLabelForState(state: VoiceState, mode: VoiceMode): string {
  switch (state) {
    case "IDLE":
      return mode === "handsfree" ? "Say Hey Pathu" : "Ready — hold to talk";
    case "LISTENING":
      return "Pathu is listening…";
    case "PROCESSING":
      return "Thinking…";
    case "SPEAKING":
      return "Pathu is speaking…";
    case "ERROR":
      return "Voice unavailable — tap to retry";
    default:
      return "Ready.";
  }
}
