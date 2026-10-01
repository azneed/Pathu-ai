import { AppState, type AppStateStatus } from "react-native";

import { chat, PathuApiError } from "@/api/client";
import { speechRecognition } from "@/speech/SpeechRecognitionService";
import { speechTts } from "@/speech/SpeechTtsService";
import { sherpaWakeWord } from "@/wakeword/SherpaWakeWord";
import type { WakeDetectionEvent } from "@/wakeword/types";

import {
  phaseToLabel,
  type VoiceConversationStatus,
  type VoiceDiagEvent,
  type VoicePhase,
} from "./types";

type Listener = (status: VoiceConversationStatus) => void;

const MAX_DIAG = 24;
const MIC_HANDOFF_MS = 350;

function now(): number {
  return Date.now();
}

/**
 * Authoritative foreground voice loop:
 * wake_listening → command_listening → processing → speaking → wake_listening
 */
class VoiceConversationControllerImpl {
  private phase: VoicePhase = "idle";
  private partialTranscript = "";
  private transcript: string | null = null;
  private reply: string | null = null;
  private error: string | null = null;
  private sttMode: VoiceConversationStatus["sttMode"] = "unknown";
  private sessionId = 0;
  private runToken = 0;
  private busy = false;
  private started = false;
  private listeners = new Set<Listener>();
  private diagnostics: VoiceDiagEvent[] = [];
  private unsubWake: (() => void) | null = null;
  private unsubStt: (() => void) | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private appState: AppStateStatus = AppState.currentState;
  private ignoreBackgroundUntil = 0;
  private backgroundPauseTimer: ReturnType<typeof setTimeout> | null = null;

  getStatus(): VoiceConversationStatus {
    return {
      phase: this.phase,
      uiLabel: phaseToLabel(this.phase),
      partialTranscript: this.partialTranscript,
      transcript: this.transcript,
      reply: this.reply,
      error: this.error,
      sttMode: this.sttMode,
      sessionId: this.sessionId,
      diagnostics: [...this.diagnostics],
    };
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

  private diag(message: string): void {
    this.diagnostics = [
      { at: now(), message },
      ...this.diagnostics,
    ].slice(0, MAX_DIAG);
    if (__DEV__) {
      console.log(`[PathuVoice] ${message}`);
    }
  }

  private setPhase(phase: VoicePhase, error: string | null = null): void {
    this.phase = phase;
    this.error = error;
    this.diag(`phase → ${phase}${error ? ` (${error})` : ""}`);
    this.emit();
  }

  async start(): Promise<void> {
    if (this.started && this.phase !== "idle" && this.phase !== "error") {
      return;
    }
    this.started = true;
    this.ignoreBackgroundUntil = Date.now() + 2500;
    this.appState = AppState.currentState;
    this.diag("controller start");

    if (!this.unsubWake) {
      this.unsubWake = sherpaWakeWord.onDetection((event) => {
        void this.onWake(event).catch((error) => {
          this.diag(
            `wake handler error: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      });
    }
    if (!this.unsubStt) {
      this.unsubStt = speechRecognition.subscribe((stt) => {
        this.sttMode = stt.mode;
        if (this.phase === "command_listening") {
          this.partialTranscript = stt.partialTranscript;
          this.emit();
        }
      });
    }
    if (!this.appStateSub) {
      this.appStateSub = AppState.addEventListener(
        "change",
        (next: AppStateStatus) => {
          void this.onAppState(next);
        },
      );
    }

    try {
      await speechRecognition.initialize();
      this.sttMode = speechRecognition.getStatus().mode;
      await this.enterWakeListening();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setPhase("error", message);
    }
  }

  async stop(): Promise<void> {
    this.runToken += 1;
    this.busy = false;
    this.diag("controller stop");
    await speechTts.stop();
    await speechRecognition.stop();
    await sherpaWakeWord.stop();
    this.started = false;
    this.setPhase("idle");
  }

  async destroy(): Promise<void> {
    await this.stop();
    this.unsubWake?.();
    this.unsubWake = null;
    this.unsubStt?.();
    this.unsubStt = null;
    this.appStateSub?.remove();
    this.appStateSub = null;
    await speechRecognition.destroy();
    await speechTts.destroy();
  }

  /** Manual mic button — skip wake, capture one command. */
  async startManualCommand(): Promise<void> {
    if (this.busy || this.phase === "command_listening" || this.phase === "processing" || this.phase === "speaking") {
      this.diag("manual command ignored (busy)");
      return;
    }
    this.diag("manual command");
    await this.beginCommandSession("manual");
  }

  /**
   * DEV/verification: run command STT from a local WAV (Android 13+ file transcription)
   * then continue through /chat + TTS + wake restart. Does not fake the transcript.
   */
  async startFileCommand(audioSourceUri: string): Promise<void> {
    if (this.busy || this.phase === "command_listening" || this.phase === "processing" || this.phase === "speaking") {
      this.diag("file command ignored (busy)");
      return;
    }
    this.diag(`file command: ${audioSourceUri}`);
    await this.beginCommandSession("file", audioSourceUri);
  }

  async cancelCommand(): Promise<void> {
    if (this.phase !== "command_listening") return;
    this.diag("command cancelled");
    this.runToken += 1;
    this.busy = false;
    await speechRecognition.stop();
    await this.enterWakeListening();
  }

  private async onAppState(next: AppStateStatus): Promise<void> {
    const prev = this.appState;
    this.appState = next;
    if (!this.started) return;

    // Android reports brief "inactive"/"background" during permission sheets
    // and UIAutomator dumps — debounce before tearing down the mic.
    if (next === "background" && prev !== "background") {
      if (Date.now() < this.ignoreBackgroundUntil) {
        this.diag("background ignored (startup grace)");
        return;
      }
      if (this.backgroundPauseTimer) {
        clearTimeout(this.backgroundPauseTimer);
      }
      this.backgroundPauseTimer = setTimeout(() => {
        this.backgroundPauseTimer = null;
        if (this.appState !== "background" || !this.started) return;
        void (async () => {
          const { wakeForegroundService } = await import(
            "@/wakeword/WakeForegroundService"
          );
          const fgsActive = await wakeForegroundService.isActive();
          this.diag(
            fgsActive
              ? "app backgrounded — keep wake (FGS active)"
              : "app backgrounded — pause voice",
          );
          this.runToken += 1;
          this.busy = false;
          await speechTts.stop();
          await speechRecognition.stop();
          if (fgsActive) {
            // Locked-screen / background wake: keep the existing KWS + FGS instance.
            // Do not restart KWS here (Android blocks starting a mic FGS from background).
            if (sherpaWakeWord.getStatus().state === "listening") {
              this.setPhase("wake_listening");
            } else {
              this.diag("background: KWS not listening; will reconcile on foreground");
              this.setPhase("idle");
            }
            return;
          }
          await sherpaWakeWord.stop();
          this.setPhase("idle");
        })();
      }, 1500);
      return;
    }

    if (next === "active") {
      if (this.backgroundPauseTimer) {
        clearTimeout(this.backgroundPauseTimer);
        this.backgroundPauseTimer = null;
      }
      if (prev === "background") {
        this.diag("app foregrounded — reconcile wake");
        const status = sherpaWakeWord.getStatus();
        if (status.lastDetection && status.state === "detected") {
          this.diag(
            `locked-screen wake visible: ${status.lastDetection.keyword}`,
          );
        }
        if (
          this.phase === "idle" ||
          this.phase === "error" ||
          (this.phase === "wake_listening" && status.state !== "listening")
        ) {
          await this.enterWakeListening();
        } else {
          this.emit();
        }
      }
    }
  }

  private async onWake(event: WakeDetectionEvent): Promise<boolean> {
    if (event.source !== "microphone") return false;
    if (!this.started) return false;

    // Phase 7B.1: while locked/background, keep KWS running and surface detection
    // in wake status. Do not start STT until the app is active again.
    if (this.appState !== "active") {
      this.diag(
        `wake while ${this.appState}: ${event.keyword} (keep KWS, no STT yet)`,
      );
      this.emit();
      return false;
    }
    if (
      this.busy ||
      this.phase === "command_listening" ||
      this.phase === "processing" ||
      this.phase === "speaking"
    ) {
      this.diag("wake ignored (session in progress)");
      return false;
    }
    this.diag(`wake detected: ${event.keyword}`);
    void this.beginCommandSession("wake");
    return true;
  }

  private async enterWakeListening(): Promise<void> {
    this.partialTranscript = "";
    await speechTts.stop();
    await speechRecognition.stop();
    // Brief settle so Android releases the mic before KWS reclaims it.
    await delay(MIC_HANDOFF_MS);
    try {
      await sherpaWakeWord.start();
      this.setPhase("wake_listening");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setPhase("error", message);
    }
  }

  private async beginCommandSession(
    reason: "wake" | "manual" | "file",
    audioSourceUri?: string,
  ): Promise<void> {
    const token = ++this.runToken;
    this.busy = true;
    this.sessionId += 1;
    this.transcript = null;
    this.reply = null;
    this.partialTranscript = "";
    this.error = null;

    try {
      this.diag(`KWS stop (${reason})`);
      await sherpaWakeWord.stop();
      await delay(MIC_HANDOFF_MS);

      if (token !== this.runToken) return;

      this.setPhase("command_listening");
      this.diag(audioSourceUri ? "STT start (file)" : "STT start");
      const finalText = await speechRecognition.start(
        audioSourceUri ? { audioSourceUri } : undefined,
      );
      this.sttMode = speechRecognition.getStatus().mode;

      if (token !== this.runToken) return;

      const transcript = (finalText ?? "").trim();
      this.diag(
        `STT end mode=${this.sttMode} chars=${transcript.length}`,
      );

      if (!transcript) {
        this.diag("empty transcript — back to wake");
        this.busy = false;
        await this.enterWakeListening();
        return;
      }

      this.transcript = transcript;
      this.partialTranscript = transcript;
      this.setPhase("processing");
      this.diag("API /chat request");

      const result = await chat({ message: transcript });
      if (token !== this.runToken) return;

      const reply =
        typeof result.reply === "string" ? result.reply.trim() : "";
      if (!reply) {
        throw new PathuApiError("Empty reply from Pathu", 502);
      }

      this.reply = reply;
      this.diag(`API /chat ok replyChars=${reply.length}`);
      this.setPhase("speaking");
      this.diag("TTS start");
      await speechTts.speak(reply);
      this.diag("TTS end");

      if (token !== this.runToken) return;
      this.busy = false;
      await this.enterWakeListening();
    } catch (error) {
      if (token !== this.runToken) return;
      const message =
        error instanceof PathuApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      this.diag(`session error: ${message}`);
      this.busy = false;
      this.setPhase("error", message);
      // Recover to wake listening after a short pause.
      await delay(800);
      if (token === this.runToken) {
        await this.enterWakeListening();
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const voiceConversation: VoiceConversationControllerImpl = (() => {
  const g = globalThis as typeof globalThis & {
    __pathuVoiceConversation?: VoiceConversationControllerImpl;
  };
  if (!g.__pathuVoiceConversation) {
    g.__pathuVoiceConversation = new VoiceConversationControllerImpl();
  }
  return g.__pathuVoiceConversation;
})();
