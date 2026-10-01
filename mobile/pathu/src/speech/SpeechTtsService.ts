import * as Speech from "expo-speech";

import type { SpeechTtsStatus } from "./types";

type Listener = (status: SpeechTtsStatus) => void;

/**
 * Speaks Pathu reply text via expo-speech (no expo-av).
 */
class SpeechTtsServiceImpl {
  private status: SpeechTtsStatus = { state: "idle", error: null };
  private listeners = new Set<Listener>();
  private speaking = false;

  getStatus(): SpeechTtsStatus {
    return { ...this.status };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.getStatus();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private setStatus(patch: Partial<SpeechTtsStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit();
  }

  async speak(text: string): Promise<void> {
    const utterance = text.trim();
    if (!utterance) {
      return;
    }

    await this.stop();

    this.speaking = true;
    this.setStatus({ state: "speaking", error: null });

    await new Promise<void>((resolve) => {
      Speech.speak(utterance, {
        language: "en-US",
        rate: 1.0,
        pitch: 1.0,
        onDone: () => {
          this.speaking = false;
          this.setStatus({ state: "idle", error: null });
          resolve();
        },
        onStopped: () => {
          this.speaking = false;
          this.setStatus({ state: "idle", error: null });
          resolve();
        },
        onError: () => {
          this.speaking = false;
          this.setStatus({
            state: "error",
            error: "TTS playback failed",
          });
          resolve();
        },
      });
    });
  }

  async stop(): Promise<void> {
    if (this.speaking || (await Speech.isSpeakingAsync())) {
      Speech.stop();
    }
    this.speaking = false;
    if (this.status.state !== "idle") {
      this.setStatus({ state: "idle" });
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }
}

export const speechTts = new SpeechTtsServiceImpl();
