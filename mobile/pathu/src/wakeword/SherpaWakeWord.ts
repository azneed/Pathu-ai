import { PermissionsAndroid, Platform } from "react-native";
import SherpaOnnx from "@siteed/sherpa-onnx.rn";
import LiveAudioStream from "react-native-live-audio-stream";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";

import { micOwnership } from "../voice/micOwnership";
import { analyzeMicCapture, buildWavBase64, type MicDiagnosticResult } from "./micDiagnostics";
import { ensureKwsModelsOnDisk } from "./ensureModels";
import { wakeForegroundService } from "./WakeForegroundService";
import type {
  WakeAudioDiagnostics,
  WakeDetectionEvent,
  WakeWordPermission,
  WakeWordState,
  WakeWordStatus,
} from "./types";

type Listener = (status: WakeWordStatus) => void;

const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 1600; // 100 ms — matches sherpa-onnx mic examples
const ENGINE_NAME = "sherpa-onnx-kws-gigaspeech-en";
/** Match official Android KWS demo (MediaRecorder.AudioSource.MIC). */
const AUDIO_SOURCE_MIC = 1;
/**
 * Per-line keyword boost/threshold kept at values proven to detect
 * TTS "Hey Pathu" offline with this exact GigSpeech int8 model.
 */
const KEYWORDS_SCORE = 1.5;
const KEYWORDS_THRESHOLD = 0.25;

function emptyAudio(): WakeAudioDiagnostics {
  return {
    framesReceived: 0,
    lastFrameBytes: 0,
    lastFrameSamples: 0,
    sampleRate: SAMPLE_RATE,
    rms: 0,
    peak: 0,
    kwsAccepts: 0,
    kwsStreamActive: false,
    lastKwsKeyword: "",
    bufferSamples: 0,
  };
}

function base64ToFloat32(base64: string): {
  samples: number[];
  byteLength: number;
} {
  // LiveAudioStream emits base64-encoded little-endian int16 PCM.
  const binary = globalThis.atob(base64);
  const byteLength = binary.length;
  const sampleCount = Math.floor(byteLength / 2);
  const out: number[] = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const lo = binary.charCodeAt(i * 2);
    const hi = binary.charCodeAt(i * 2 + 1);
    let sample = (hi << 8) | lo;
    if (sample & 0x8000) sample = sample - 0x10000;
    out[i] = sample / 32768;
  }
  return { samples: out, byteLength };
}

function pcm16FileToFloat32(base64: string): number[] {
  // Strip WAV header if present (44-byte canonical PCM header).
  const binary = globalThis.atob(base64);
  let offset = 0;
  if (
    binary.length > 44 &&
    binary.startsWith("RIFF") &&
    binary.slice(8, 12) === "WAVE"
  ) {
    // Find "data" chunk
    let i = 12;
    while (i + 8 < binary.length) {
      const id = binary.slice(i, i + 4);
      const size =
        binary.charCodeAt(i + 4) |
        (binary.charCodeAt(i + 5) << 8) |
        (binary.charCodeAt(i + 6) << 16) |
        (binary.charCodeAt(i + 7) << 24);
      if (id === "data") {
        offset = i + 8;
        break;
      }
      i += 8 + size;
    }
    if (offset === 0) offset = 44;
  }
  const sampleCount = Math.floor((binary.length - offset) / 2);
  const out: number[] = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const lo = binary.charCodeAt(offset + i * 2);
    const hi = binary.charCodeAt(offset + i * 2 + 1);
    let sample = (hi << 8) | lo;
    if (sample & 0x8000) sample = sample - 0x10000;
    out[i] = sample / 32768;
  }
  return out;
}

function frameStats(samples: number[]): { rms: number; peak: number } {
  if (samples.length === 0) return { rms: 0, peak: 0 };
  let sumSq = 0;
  let peak = 0;
  for (const s of samples) {
    const a = Math.abs(s);
    if (a > peak) peak = a;
    sumSq += s * s;
  }
  return { rms: Math.sqrt(sumSq / samples.length), peak };
}

/**
 * Foreground-only local wake-word detector (Phase 7A).
 * Uses sherpa-onnx open-vocabulary KWS with keyword "HEY PATHU".
 */
class SherpaWakeWordService {
  private state: WakeWordState = "idle";
  private permission: WakeWordPermission = "unknown";
  private error: string | null = null;
  private detectionCount = 0;
  private lastDetection: WakeDetectionEvent | null = null;
  private listeners = new Set<Listener>();
  private streaming = false;
  private initialized = false;
  private pcmBuffer: number[] = [];
  private processing = false;
  private cooldownUntil = 0;
  private audio: WakeAudioDiagnostics = emptyAudio();
  private diagEmitCounter = 0;

  private detectionHandlers = new Set<
    (
      event: WakeDetectionEvent,
    ) => boolean | void | Promise<boolean | void>
  >();

  getStatus(): WakeWordStatus {
    return {
      state: this.state,
      permission: this.permission,
      error: this.error,
      detectionCount: this.detectionCount,
      lastDetection: this.lastDetection,
      engine: ENGINE_NAME,
      audio: { ...this.audio, bufferSamples: this.pcmBuffer.length },
    };
  }

  /**
   * External orchestration (voice controller) listens here.
   * When handlers are registered, mic streaming stops after a mic detection
   * so STT can take the microphone without fighting KWS.
   */
  onDetection(
    handler: (
      event: WakeDetectionEvent,
    ) => boolean | void | Promise<boolean | void>,
  ): () => void {
    this.detectionHandlers.add(handler);
    return () => {
      this.detectionHandlers.delete(handler);
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
    const status = this.getStatus();
    for (const listener of this.listeners) {
      listener(status);
    }
  }

  private setState(state: WakeWordState, error: string | null = null): void {
    this.state = state;
    this.error = error;
    this.emit();
  }

  async requestPermission(): Promise<WakeWordPermission> {
    if (Platform.OS !== "android") {
      this.permission = "denied";
      this.emit();
      return this.permission;
    }
    const already = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    if (already) {
      this.permission = "granted";
      this.emit();
      return this.permission;
    }
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: "Microphone permission",
        message:
          "Pathu needs the microphone for local on-device wake-word detection.",
        buttonPositive: "Allow",
        buttonNegative: "Deny",
      },
    );
    this.permission =
      result === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "denied";
    this.emit();
    return this.permission;
  }

  async initialize(): Promise<void> {
    if (this.initialized && this.state !== "error") {
      return;
    }
    this.setState("initializing");
    try {
      const lib = await SherpaOnnx.validateLibraryLoaded();
      if (!lib.loaded) {
        throw new Error(lib.status || "sherpa-onnx native library not loaded");
      }

      const models = await ensureKwsModelsOnDisk();
      const init = await SherpaOnnx.KWS.init({
        modelDir: models.modelDir,
        modelType: "zipformer2",
        modelFiles: models.modelFiles,
        keywordsFile: models.keywordsFile,
        numThreads: 2,
        provider: "cpu",
        keywordsScore: KEYWORDS_SCORE,
        keywordsThreshold: KEYWORDS_THRESHOLD,
        maxActivePaths: 4,
        numTrailingBlanks: 2,
        debug: true,
      });
      if (!init.success) {
        throw new Error(init.error || "KWS init failed");
      }
      this.initialized = true;
      this.audio.kwsStreamActive = true;
      this.setState("idle");
    } catch (error) {
      this.initialized = false;
      this.audio.kwsStreamActive = false;
      const message = error instanceof Error ? error.message : String(error);
      this.setState("error", message);
      throw error;
    }
  }

  private levelWindowPeak = 0;

  /** start/stop are serialized so overlapping callers cannot open a second mic stream. */
  private lifecycle: Promise<unknown> = Promise.resolve();

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lifecycle.then(fn, fn);
    this.lifecycle = run.catch(() => undefined);
    return run;
  }

  start(): Promise<void> {
    return this.serialize(() => this.startInternal());
  }

  private async startInternal(): Promise<void> {
    if (this.streaming && this.state === "listening") {
      if (__DEV__) console.log("[PathuWake] duplicate start ignored (already listening)");
      return;
    }
    // Ensure no leftover LiveAudioStream callback from a prior hot-reload/session.
    if (this.streaming) {
      await this.stopInternal();
    }

    try {
      if (this.permission !== "granted") {
        const perm = await this.requestPermission();
        if (perm !== "granted") {
          this.setState("error", "Microphone permission denied");
          return;
        }
      }

      if (!this.initialized) {
        await this.initialize();
      }

      this.pcmBuffer = [];
      this.processing = false;
      this.audio = {
        ...emptyAudio(),
        kwsStreamActive: this.initialized,
        sampleRate: SAMPLE_RATE,
      };

      try {
        LiveAudioStream.stop();
      } catch {
        // ignore — may not have been started
      }

      LiveAudioStream.init({
        sampleRate: SAMPLE_RATE,
        channels: 1,
        bitsPerSample: 16,
        audioSource: AUDIO_SOURCE_MIC,
        bufferSize: FRAME_SAMPLES * 2,
        wavFile: "",
      });

      LiveAudioStream.on("data", (data: string) => {
        void this.onPcmChunk(data);
      });

      micOwnership.acquire("KWS", "LiveAudioStream.start");
      LiveAudioStream.start();
      this.streaming = true;
      this.audio.kwsStreamActive = true;

      // Keep process + mic eligibility while screen locked (Phase 7B.1).
      // FGS does not open a second microphone — JS LiveAudioStream remains sole consumer.
      try {
        await wakeForegroundService.start();
      } catch (fgsError) {
        const message =
          fgsError instanceof Error ? fgsError.message : String(fgsError);
        if (__DEV__) {
          console.warn(`[PathuWake] FGS start failed (KWS still foreground-only): ${message}`);
        }
      }

      this.setState("listening");
    } catch (error) {
      this.streaming = false;
      const message = error instanceof Error ? error.message : String(error);
      this.setState("error", `Mic start failed: ${message}`);
      throw error;
    }
  }

  private async onPcmChunk(base64: string): Promise<void> {
    if (!this.streaming) return;
    try {
      const { samples, byteLength } = base64ToFloat32(base64);
      const stats = frameStats(samples);
      this.audio.framesReceived += 1;
      this.audio.lastFrameBytes = byteLength;
      this.audio.lastFrameSamples = samples.length;
      this.audio.rms = stats.rms;
      this.audio.peak = stats.peak;
      this.pcmBuffer.push(...samples);

      if (__DEV__) {
        this.levelWindowPeak = Math.max(this.levelWindowPeak, stats.peak);
        if (this.audio.framesReceived % 10 === 0) {
          if (this.levelWindowPeak >= 0.15) {
            console.log(`[PathuWake] level peak=${this.levelWindowPeak.toFixed(3)}`);
          }
          this.levelWindowPeak = 0;
        }
      }

      // Throttle UI updates (~4 Hz) so diagnostics stay readable.
      this.diagEmitCounter += 1;
      if (this.diagEmitCounter % 4 === 0) {
        this.emit();
      }

      if (this.processing) return;
      this.processing = true;
      try {
        while (this.streaming && this.pcmBuffer.length >= FRAME_SAMPLES) {
          const frame = this.pcmBuffer.splice(0, FRAME_SAMPLES);
          const result = await SherpaOnnx.KWS.acceptWaveform(SAMPLE_RATE, frame);
          this.audio.kwsAccepts += 1;
          this.audio.kwsStreamActive = true;

          if (!result.success) {
            if (result.error) {
              this.setState("error", result.error);
              await this.stop();
              return;
            }
            continue;
          }

          if (result.detected && result.keyword) {
            this.audio.lastKwsKeyword = result.keyword;
            await this.handleDetection(result.keyword, "microphone");
          }
        }
      } finally {
        this.processing = false;
      }
    } catch (error) {
      this.processing = false;
      const message = error instanceof Error ? error.message : String(error);
      this.setState("error", message);
      await this.stop();
    }
  }

  private async handleDetection(
    keyword: string,
    source: WakeDetectionEvent["source"],
  ): Promise<void> {
    const now = Date.now();
    if (source === "microphone" && now < this.cooldownUntil) {
      await SherpaOnnx.KWS.resetStream();
      return;
    }
    this.cooldownUntil = now + 1500;
    this.detectionCount += 1;
    this.lastDetection = { keyword, at: now, source };
    this.setState("detected");
    await SherpaOnnx.KWS.resetStream();

    if (source === "microphone" && this.detectionHandlers.size > 0) {
      const event = this.lastDetection;
      let handoff = false;
      for (const handler of [...this.detectionHandlers]) {
        try {
          const result = await Promise.resolve(handler(event));
          if (result === true) {
            handoff = true;
          }
        } catch {
          // Controllers handle their own errors.
        }
      }
      if (handoff) {
        // Hand off mic to speech recognition: stop KWS + FGS cleanly.
        await this.stop();
        return;
      }
    }

    if (this.streaming) {
      this.setState("listening");
    } else if (source === "wav-test") {
      this.setState("idle");
    }
  }

  /**
   * Feed a known-good 16 kHz mono PCM WAV through the same KWS acceptWaveform
   * path (independent of the microphone). Used to separate mic vs model issues.
   */
  async runWavSelfTest(): Promise<boolean> {
    try {
      if (this.streaming) {
        await this.stop();
      }
      if (!this.initialized) {
        await this.initialize();
      }

      const asset = Asset.fromModule(
        require("../../assets/wakeword/testdata/hey_pathu_16k.wav"),
      );
      await asset.downloadAsync();
      if (!asset.localUri) {
        throw new Error("Test WAV asset missing");
      }
      const b64 = await FileSystem.readAsStringAsync(asset.localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const samples = pcm16FileToFloat32(b64);
      if (samples.length < FRAME_SAMPLES) {
        throw new Error(`Test WAV too short (${samples.length} samples)`);
      }

      await SherpaOnnx.KWS.resetStream();
      let detected = false;
      for (let i = 0; i + FRAME_SAMPLES <= samples.length; i += FRAME_SAMPLES) {
        const frame = samples.slice(i, i + FRAME_SAMPLES);
        const result = await SherpaOnnx.KWS.acceptWaveform(SAMPLE_RATE, frame);
        this.audio.kwsAccepts += 1;
        if (result.success && result.detected && result.keyword) {
          this.audio.lastKwsKeyword = result.keyword;
          await this.handleDetection(result.keyword, "wav-test");
          detected = true;
          break;
        }
      }
      if (!detected) {
        // Tail padding like official sherpa examples (~0.8s silence)
        const pad = new Array(Math.floor(SAMPLE_RATE * 0.8)).fill(0);
        for (let i = 0; i + FRAME_SAMPLES <= pad.length; i += FRAME_SAMPLES) {
          const frame = pad.slice(i, i + FRAME_SAMPLES);
          const result = await SherpaOnnx.KWS.acceptWaveform(SAMPLE_RATE, frame);
          this.audio.kwsAccepts += 1;
          if (result.success && result.detected && result.keyword) {
            this.audio.lastKwsKeyword = result.keyword;
            await this.handleDetection(result.keyword, "wav-test");
            detected = true;
            break;
          }
        }
      }
      if (!detected) {
        this.setState(
          "error",
          "WAV self-test: model did not detect HEY PATHU on known-good audio",
        );
      }
      this.emit();
      return detected;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setState("error", message);
      return false;
    }
  }

  /**
   * DEV diagnostic: capture a short raw mic window through the same LiveAudioStream
   * config, report summary stats, save a local app-private WAV, then feed the exact
   * captured samples through KWS the same way as the WAV self-test.
   */
  runMicDiagnostic(durationMs = 5000): Promise<MicDiagnosticResult> {
    const audioSource = AUDIO_SOURCE_MIC;
    const fileName = "mic_diag.wav";
    const sampleRate = SAMPLE_RATE;
    const channels = 1;
    return this.serialize(async () => {
      const wasStreaming = this.streaming;
      if (wasStreaming) {
        await this.stopInternal();
        await new Promise((r) => setTimeout(r, 400));
      }
      if (this.permission !== "granted") {
        await this.requestPermission();
      }
      if (!this.initialized) {
        await this.initialize();
      }

      const chunks: string[] = [];
      const arrivals: number[] = [];
      const bufferBytes = FRAME_SAMPLES * 2;
      LiveAudioStream.init({
        sampleRate,
        channels,
        bitsPerSample: 16,
        audioSource,
        bufferSize: bufferBytes,
        wavFile: "",
      });
      LiveAudioStream.on("data", (data: string) => {
        chunks.push(data);
        arrivals.push(Date.now());
      });
      micOwnership.acquire("DIAG", "mic diagnostic");
      console.log(
        `[PathuMicDiag] recording ${durationMs}ms (config ${sampleRate}Hz ${channels}ch PCM16 source=${audioSource} buffer=${bufferBytes}B)`,
      );
      LiveAudioStream.start();
      await new Promise((r) => setTimeout(r, durationMs));
      LiveAudioStream.stop();
      try {
        LiveAudioStream.removeAllListeners?.("data");
      } catch {
        // ignore
      }
      micOwnership.release("DIAG", "mic diagnostic done");

      const { result, int16 } = analyzeMicCapture({ chunks, arrivals, durationMs, sampleRate, channels });

      try {
        const dir = FileSystem.documentDirectory;
        if (dir) {
          const path = `${dir}${fileName}`;
          await FileSystem.writeAsStringAsync(path, buildWavBase64(int16, sampleRate, channels), {
            encoding: FileSystem.EncodingType.Base64,
          });
          result.wavPath = path;
        }
      } catch {
        result.wavPath = null;
      }

      await SherpaOnnx.KWS.resetStream();
      let detected = false;
      let keyword = "";
      let frames = 0;
      const floats = new Array<number>(int16.length);
      for (let i = 0; i < int16.length; i++) floats[i] = int16[i] / 32768;
      const padded = floats.concat(new Array(Math.floor(SAMPLE_RATE * 0.8)).fill(0));
      for (let i = 0; i + FRAME_SAMPLES <= padded.length; i += FRAME_SAMPLES) {
        const r = await SherpaOnnx.KWS.acceptWaveform(SAMPLE_RATE, padded.slice(i, i + FRAME_SAMPLES));
        frames += 1;
        if (r.success && r.detected && r.keyword) {
          detected = true;
          keyword = r.keyword;
          break;
        }
      }
      await SherpaOnnx.KWS.resetStream();
      result.kwsOffline = { detected, keyword, frames };

      console.log(`[PathuMicDiag] ${JSON.stringify(result)}`);

      if (wasStreaming) {
        await this.startInternal();
      }
      return result;
    });
  }

  /**
   * Stop LiveAudioStream only (keep FGS if still desired by caller).
   * Used for STT handoff — VoiceConversationController stops FGS when appropriate.
   */
  private async stopStreamingOnly(): Promise<void> {
    if (this.streaming) {
      try {
        LiveAudioStream.stop();
      } catch {
        // ignore
      }
      try {
        LiveAudioStream.removeAllListeners?.("data");
      } catch {
        // ignore
      }
      this.streaming = false;
      micOwnership.release("KWS", "LiveAudioStream.stop");
    }
    this.pcmBuffer = [];
    this.processing = false;
    this.audio.kwsStreamActive = this.initialized;
    if (this.state !== "error") {
      this.setState("idle");
    } else {
      this.emit();
    }
  }

  stop(): Promise<void> {
    return this.serialize(() => this.stopInternal());
  }

  private async stopInternal(): Promise<void> {
    await this.stopStreamingOnly();
    try {
      await wakeForegroundService.stop();
    } catch {
      // ignore
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
    if (this.initialized) {
      try {
        await SherpaOnnx.KWS.release();
      } catch {
        // ignore
      }
      this.initialized = false;
    }
    this.detectionCount = 0;
    this.lastDetection = null;
    this.audio = emptyAudio();
    this.setState("idle");
  }
}

export const sherpaWakeWord: SherpaWakeWordService = (() => {
  const g = globalThis as typeof globalThis & {
    __pathuSherpaWakeWord?: SherpaWakeWordService;
  };
  if (!g.__pathuSherpaWakeWord) {
    g.__pathuSherpaWakeWord = new SherpaWakeWordService();
  }
  return g.__pathuSherpaWakeWord;
})();
