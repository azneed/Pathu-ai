import { requireNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

export type PathuAssistantStatus = {
  isDefaultAssistant: boolean;
  serviceState: string;
  sessionState: string;
  wakeState: string;
  lastEvent: string;
  lastScreenEvent: string;
  uptimeSeconds: number;
  heartbeats: number;
  lastError: string | null;
};

type PathuAssistantNativeModule = {
  getStatus(): Promise<PathuAssistantStatus>;
};

function getNative(): PathuAssistantNativeModule | null {
  if (Platform.OS !== "android") return null;
  try {
    return requireNativeModule("PathuAssistant") as PathuAssistantNativeModule;
  } catch {
    return null;
  }
}

/** Status of the native VoiceInteractionService assistant path (null when unavailable). */
export async function getAssistantStatus(): Promise<PathuAssistantStatus | null> {
  return (await getNative()?.getStatus()) ?? null;
}
