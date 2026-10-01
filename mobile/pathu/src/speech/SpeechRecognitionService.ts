import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionOptions,
} from "expo-speech-recognition";

import { micOwnership } from "../voice/micOwnership";
import type {
  SpeechRecognitionMode,
  SpeechRecognitionStatus,
} from "./types";

type Listener = (status: SpeechRecognitionStatus) => void;
type Subscription = { remove: () => void };

const LANG = "en-US";
const COMMAND_TIMEOUT_MS = 12_000;

function emptyStatus(
  overrides: Partial<SpeechRecognitionStatus> = {},
): SpeechRecognitionStatus {
  return {
    state: "idle",
    partialTranscript: "",
    finalTranscript: null,
    error: null,
    mode: "unknown",
    onDeviceAvailable: false,
    ...overrides,
  };
}

/**
 * Thin wrapper around expo-speech-recognition for one-shot command capture.
 * Prefer on-device recognition when Android supports it; otherwise system/remote.
 */
class SpeechRecognitionServiceImpl {
  private status: SpeechRecognitionStatus = emptyStatus();
  private listeners = new Set<Listener>();
  private subscriptions: Subscription[] = [];
  private sessionActive = false;
  private resolveSession: ((transcript: string | null) => void) | null = null;
  private rejectSession: ((error: Error) => void) | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastFinal = "";
  private partialCount = 0;
  private sessionUsesMic = false;

  getStatus(): SpeechRecognitionStatus {
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

  private setStatus(patch: Partial<SpeechRecognitionStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit();
  }

  async initialize(): Promise<void> {
    const onDeviceAvailable =
      ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
    this.setStatus({
      onDeviceAvailable,
      mode: onDeviceAvailable ? "on-device" : "system",
      error: null,
    });

    const permissions =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permissions.granted) {
      this.setStatus({
        state: "error",
        error: "Speech recognition permission denied",
      });
      throw new Error("Speech recognition permission denied");
    }
  }

  private clearTimeoutTimer(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  private detachListeners(): void {
    for (const sub of this.subscriptions) {
      try {
        sub.remove();
      } catch {
        // ignore
      }
    }
    this.subscriptions = [];
  }

  private sttDiag(message: string): void {
    if (__DEV__) console.log(`[PathuSTT] ${message}`);
  }

  private releaseMic(reason: string): void {
    if (this.sessionUsesMic) micOwnership.release("STT", reason);
    this.sessionUsesMic = false;
  }

  private settleOk(transcript: string | null): void {
    if (!this.sessionActive) return;
    this.sessionActive = false;
    this.sttDiag(`ended ok chars=${transcript?.length ?? 0}`);
    this.releaseMic("STT ended");
    this.clearTimeoutTimer();
    this.detachListeners();
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // ignore
    }

    if (transcript) {
      this.setStatus({
        state: "recognized",
        finalTranscript: transcript,
        partialTranscript: transcript,
        error: null,
      });
    } else {
      this.setStatus({
        state: "idle",
        finalTranscript: null,
        error: "No speech recognized",
      });
    }

    const resolve = this.resolveSession;
    this.resolveSession = null;
    this.rejectSession = null;
    resolve?.(transcript);
  }

  private settleError(message: string): void {
    if (!this.sessionActive) return;
    this.sessionActive = false;
    this.sttDiag(`ended error ${message}`);
    this.releaseMic("STT error");
    this.clearTimeoutTimer();
    this.detachListeners();
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // ignore
    }

    this.setStatus({
      state: "error",
      error: message,
      finalTranscript: this.lastFinal || null,
    });

    const reject = this.rejectSession;
    this.resolveSession = null;
    this.rejectSession = null;
    reject?.(new Error(message));
  }

  /**
   * Capture a single spoken command. Resolves with final transcript or null.
   * Rejects on hard recognition failures (permission, mic busy, etc.).
   *
   * Optional `audioSourceUri` (file://...) uses file transcription instead of the mic
   * — useful for on-device verification without acoustic coupling.
   */
  async start(options?: { audioSourceUri?: string }): Promise<string | null> {
    if (this.sessionActive) {
      await this.stop();
    }

    await this.initialize();

    const onDeviceAvailable =
      ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
    const fileUri = options?.audioSourceUri;

    // Prefer on-device when available; if it yields nothing, retry with system.
    // File transcription typically works better on-device on Android 13+.
    if (onDeviceAvailable || fileUri) {
      const preferOnDevice = onDeviceAvailable || Boolean(fileUri);
      const onDevice = await this.runSession({
        preferOnDevice,
        mode: preferOnDevice ? "on-device" : "system",
        onDeviceAvailable,
        audioSourceUri: fileUri,
      });
      if (onDevice && onDevice.trim()) {
        return onDevice;
      }
      if (!fileUri && onDeviceAvailable) {
        this.diagFallback("on-device empty — retry system STT");
        // Starting immediately makes the system recognizer fail with an instant
        // "no-speech" while the on-device session is still releasing.
        await new Promise((r) => setTimeout(r, 500));
      } else if (fileUri) {
        return onDevice;
      }
    }

    return this.runSession({
      preferOnDevice: false,
      mode: "system",
      onDeviceAvailable,
      audioSourceUri: fileUri,
    });
  }

  private diagFallback(message: string): void {
    if (__DEV__) {
      console.log(`[PathuSTT] ${message}`);
    }
  }

  private async runSession(args: {
    preferOnDevice: boolean;
    mode: SpeechRecognitionMode;
    onDeviceAvailable: boolean;
    audioSourceUri?: string;
  }): Promise<string | null> {
    if (this.sessionActive) {
      await this.stop();
    }

    const { preferOnDevice, mode, onDeviceAvailable, audioSourceUri } = args;
    this.lastFinal = "";
    this.setStatus({
      state: "listening",
      partialTranscript: "",
      finalTranscript: null,
      error: null,
      mode,
      onDeviceAvailable,
    });

    this.sessionActive = true;
    this.partialCount = 0;
    this.sessionUsesMic = !audioSourceUri;
    if (this.sessionUsesMic) micOwnership.acquire("STT", `STT ${mode}`);
    this.sttDiag(
      `start mode=${mode} requiresOnDevice=${preferOnDevice} onDeviceAvailable=${onDeviceAvailable} source=${audioSourceUri ? "file" : "mic"}`,
    );

    return new Promise<string | null>((resolve, reject) => {
      this.resolveSession = resolve;
      this.rejectSession = reject;

      for (const name of ["start", "audiostart", "speechstart", "speechend", "audioend"] as const) {
        this.subscriptions.push(
          ExpoSpeechRecognitionModule.addListener(name, () => this.sttDiag(`event ${name}`)),
        );
      }

      this.subscriptions.push(
        ExpoSpeechRecognitionModule.addListener("result", (event) => {
          const top = event.results?.[0]?.transcript?.trim() ?? "";
          if (!event.isFinal) this.partialCount += 1;
          this.sttDiag(
            `result final=${event.isFinal} partials=${this.partialCount} chars=${top.length}${event.isFinal ? ` text="${top}"` : ""}`,
          );
          if (!top) return;
          if (event.isFinal) {
            this.lastFinal = top;
            this.setStatus({
              partialTranscript: top,
              finalTranscript: top,
            });
            this.settleOk(top);
          } else {
            this.setStatus({ partialTranscript: top });
          }
        }),
      );

      this.subscriptions.push(
        ExpoSpeechRecognitionModule.addListener("error", (event) => {
          const code = event.error ?? "unknown";
          this.sttDiag(`error code=${code} message=${event.message ?? ""}`);
          if (
            code === "aborted" ||
            code === "no-speech" ||
            code === "speech-timeout"
          ) {
            this.settleOk(this.lastFinal || null);
            return;
          }
          this.settleError(event.message || `Speech recognition error: ${code}`);
        }),
      );

      this.subscriptions.push(
        ExpoSpeechRecognitionModule.addListener("end", () => {
          this.sttDiag(`event end partials=${this.partialCount}`);
          if (this.sessionActive) {
            this.settleOk(this.lastFinal || null);
          }
        }),
      );

      this.subscriptions.push(
        ExpoSpeechRecognitionModule.addListener("nomatch", () => {
          if (this.sessionActive) {
            this.settleOk(this.lastFinal || null);
          }
        }),
      );

      const options: ExpoSpeechRecognitionOptions = {
        lang: LANG,
        interimResults: true,
        continuous: false,
        requiresOnDeviceRecognition: preferOnDevice,
        addsPunctuation: false,
      };

      if (audioSourceUri) {
        options.audioSource = {
          uri: audioSourceUri,
          audioChannels: 1,
          sampleRate: 16000,
        };
      }

      try {
        ExpoSpeechRecognitionModule.start(options);
      } catch (error) {
        if (preferOnDevice) {
          try {
            this.setStatus({ mode: "system" });
            ExpoSpeechRecognitionModule.start({
              ...options,
              requiresOnDeviceRecognition: false,
            });
          } catch (fallbackError) {
            const message =
              fallbackError instanceof Error
                ? fallbackError.message
                : String(fallbackError);
            this.settleError(message);
            return;
          }
        } else {
          const message =
            error instanceof Error ? error.message : String(error);
          this.settleError(message);
          return;
        }
      }

      this.timeoutId = setTimeout(() => {
        if (this.sessionActive) {
          try {
            ExpoSpeechRecognitionModule.stop();
          } catch {
            // ignore
          }
          setTimeout(() => {
            if (this.sessionActive) {
              this.settleOk(this.lastFinal || null);
            }
          }, 800);
        }
      }, COMMAND_TIMEOUT_MS);
    });
  }

  async stop(): Promise<void> {
    if (!this.sessionActive) {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {
        // ignore
      }
      return;
    }
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => {
      const prevResolve = this.resolveSession;
      const prevReject = this.rejectSession;
      this.resolveSession = (transcript) => {
        prevResolve?.(transcript);
        resolve();
      };
      this.rejectSession = (error) => {
        prevReject?.(error);
        resolve();
      };
      setTimeout(() => {
        if (this.sessionActive) {
          this.settleOk(this.lastFinal || null);
        }
        resolve();
      }, 600);
    });
  }

  async destroy(): Promise<void> {
    this.clearTimeoutTimer();
    this.detachListeners();
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // ignore
    }
    this.sessionActive = false;
    this.resolveSession = null;
    this.rejectSession = null;
    this.setStatus(
      emptyStatus({ onDeviceAvailable: this.status.onDeviceAvailable }),
    );
  }
}

export const speechRecognition = new SpeechRecognitionServiceImpl();
