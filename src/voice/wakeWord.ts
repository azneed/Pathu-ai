import {
  DEFAULT_WAKE_PHRASES,
  extractCommandAfterWake,
} from "./phrases.js";

export interface WakeEvent {
  phrase: string;
  /** Remaining command text after the wake phrase (may be empty). */
  command: string;
  rawTranscript: string;
}

export type WakeCallback = (event: WakeEvent) => void;

/**
 * Browser-agnostic wake detector contract.
 * Implementations must not call Pathu /chat or any LLM.
 */
export interface WakeWordDetector {
  readonly kind: string;
  /** Human-readable privacy/engine note. */
  readonly privacyNote: string;
  start(): Promise<void> | void;
  stop(): void;
  onWake(callback: WakeCallback): void;
  destroy(): void;
}

export interface TranscriptWakeWordOptions {
  phrases?: readonly string[];
  /**
   * Injected speech-recognition factory for tests / browsers.
   * Must return an object with start/stop and event handlers.
   */
  createRecognition: () => SpeechRecognitionLike;
  /** Ignore wake events while this returns false. */
  isArmed?: () => boolean;
}

/** Minimal SpeechRecognition surface used by the transcript detector. */
export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort?: () => void;
}

export interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

/**
 * INTERIM wake detector: uses Web Speech API transcripts to match wake phrases.
 *
 * Limitations (documented intentionally):
 * - Not a true on-device neural wake-word model.
 * - On Chromium, Web Speech recognition may send audio to the browser vendor
 *   (e.g. Google) for STT — audio does NOT go to Pathu/Gemini/OpenRouter.
 * - False positives/negatives are more likely than with Porcupine custom models.
 *
 * True local "Hey Pathu" requires a custom Porcupine (.ppn) model + AccessKey
 * (see PorcupineWakeWordDetector stub).
 */
export class TranscriptWakeWordDetector implements WakeWordDetector {
  readonly kind = "transcript-webspeech";
  readonly privacyNote =
    "Wake matching uses browser SpeechRecognition transcripts. Chromium may send microphone audio to the browser vendor for STT. Audio is not sent to Pathu LLM providers. For fully local neural wake-word, configure a Porcupine custom model.";

  private callback: WakeCallback | null = null;
  private recognition: SpeechRecognitionLike | null = null;
  private running = false;
  private restarting = false;
  private readonly phrases: readonly string[];
  private readonly createRecognition: () => SpeechRecognitionLike;
  private readonly isArmed: () => boolean;
  private lastFiredAt = 0;

  constructor(options: TranscriptWakeWordOptions) {
    this.phrases = options.phrases ?? DEFAULT_WAKE_PHRASES;
    this.createRecognition = options.createRecognition;
    this.isArmed = options.isArmed ?? (() => true);
  }

  onWake(callback: WakeCallback): void {
    this.callback = callback;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.ensureRecognition();
    try {
      this.recognition?.start();
    } catch {
      // already started
    }
  }

  stop(): void {
    this.running = false;
    try {
      this.recognition?.stop();
    } catch {
      // ignore
    }
  }

  destroy(): void {
    this.stop();
    if (this.recognition?.abort) {
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
    }
    this.recognition = null;
    this.callback = null;
  }

  /** Test helper: feed a transcript as if SpeechRecognition produced it. */
  handleTranscriptForTests(transcript: string, isFinal = true): void {
    this.processTranscript(transcript, isFinal);
  }

  private ensureRecognition(): void {
    if (this.recognition) return;
    const recognition = this.createRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let chunk = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        chunk += event.results[i]![0].transcript;
      }
      const isFinal = Boolean(event.results[event.results.length - 1]?.isFinal);
      this.processTranscript(chunk, isFinal);
    };
    recognition.onerror = () => {
      // Keep running; onend will restart if still armed.
    };
    recognition.onend = () => {
      if (!this.running || this.restarting) return;
      this.restarting = true;
      setTimeout(() => {
        this.restarting = false;
        if (!this.running) return;
        try {
          this.recognition?.start();
        } catch {
          // ignore
        }
      }, 250);
    };
    this.recognition = recognition;
  }

  private processTranscript(transcript: string, _isFinal: boolean): void {
    if (!this.running || !this.isArmed()) return;
    const extracted = extractCommandAfterWake(transcript, this.phrases);
    if (!extracted.woke || !extracted.phrase) return;

    // Debounce duplicate fires from interim+final
    const now = Date.now();
    if (now - this.lastFiredAt < 1500) return;
    this.lastFiredAt = now;

    this.callback?.({
      phrase: extracted.phrase,
      command: extracted.command,
      rawTranscript: transcript,
    });
  }
}

/**
 * Placeholder for a future Picovoice Porcupine engine.
 * Not active until AccessKey + custom Web WASM .ppn models are provided.
 * Detection would be fully local (WASM); no mic audio to Pathu LLMs.
 */
export class PorcupineWakeWordDetector implements WakeWordDetector {
  readonly kind = "porcupine";
  readonly privacyNote =
    "Porcupine runs wake-word inference locally in WebAssembly. Requires Picovoice AccessKey and a custom 'Hey Pathu' .ppn model trained in Picovoice Console (Web WASM). Not configured in this build.";

  onWake(_callback: WakeCallback): void {
    // no-op until configured
  }

  async start(): Promise<void> {
    throw new Error(
      "Porcupine wake-word is not configured. Train a custom 'Hey Pathu' Web WASM model in Picovoice Console and provide AccessKey + .ppn assets.",
    );
  }

  stop(): void {}

  destroy(): void {}
}

export function createWakeWordDetector(options: {
  engine?: "transcript" | "porcupine";
  phrases?: readonly string[];
  createRecognition?: () => SpeechRecognitionLike;
  isArmed?: () => boolean;
}): WakeWordDetector {
  const engine = options.engine ?? "transcript";
  if (engine === "porcupine") {
    return new PorcupineWakeWordDetector();
  }
  if (!options.createRecognition) {
    throw new Error("transcript wake detector requires createRecognition");
  }
  return new TranscriptWakeWordDetector({
    phrases: options.phrases,
    createRecognition: options.createRecognition,
    isArmed: options.isArmed,
  });
}
