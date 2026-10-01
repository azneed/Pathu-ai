import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";

import { speechRecognition } from "@/speech/SpeechRecognitionService";
import { micOwnership } from "@/voice/micOwnership";
import { voiceConversation } from "@/voice/VoiceConversationController";
import type { MicDiagnosticResult } from "@/wakeword/micDiagnostics";
import { sherpaWakeWord } from "@/wakeword/SherpaWakeWord";
import type { WakeWordStatus } from "@/wakeword/types";

/**
 * Phase 7A foreground wake-word test controls (not production UX).
 */
export function WakeWordTestPanel() {
  const [status, setStatus] = useState<WakeWordStatus>(sherpaWakeWord.getStatus());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = sherpaWakeWord.subscribe(setStatus);
    return () => {
      unsubscribe();
      // Do not stop KWS here — VoiceConversationController owns mic lifecycle.
    };
  }, []);

  const onStart = async () => {
    setBusy(true);
    try {
      await sherpaWakeWord.start();
    } catch {
      // status.error already set
    } finally {
      setBusy(false);
    }
  };

  const onStop = async () => {
    setBusy(true);
    try {
      await sherpaWakeWord.stop();
    } finally {
      setBusy(false);
    }
  };

  const onWavTest = async () => {
    setBusy(true);
    try {
      const ok = await sherpaWakeWord.runWavSelfTest();
      // After proving the model path, continue into mic listening so we can
      // validate the live audio pipeline without relying on a second tap.
      if (ok) {
        await sherpaWakeWord.start();
      }
    } catch {
      // status.error already set
    } finally {
      setBusy(false);
    }
  };

  const [sttResult, setSttResult] = useState<string | null>(null);
  const [diag, setDiag] = useState<MicDiagnosticResult | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);

  const onMicDiag = async () => {
    setDiagRunning(true);
    try {
      setDiag(await sherpaWakeWord.runMicDiagnostic(5000));
    } catch {
      // status.error already set
    } finally {
      setDiagRunning(false);
    }
  };

  const listening = status.state === "listening";
  const lastAt = status.lastDetection
    ? new Date(status.lastDetection.at).toLocaleTimeString()
    : "—";
  const a = status.audio;

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Wake word (Phase 7A · foreground)</Text>
      <Text style={styles.meta}>Engine: {status.engine}</Text>
      <Text style={styles.meta}>Phrase: Hey Pathu (local sherpa-onnx KWS)</Text>
      <Text style={styles.meta}>
        Mic: {status.permission} · State: {status.state}
      </Text>
      <Text style={styles.meta}>
        Detections: {status.detectionCount} · Last: {lastAt}
        {status.lastDetection ? ` (${status.lastDetection.source})` : ""}
      </Text>
      {status.lastDetection ? (
        <Text style={styles.detected}>
          Hey Pathu detected ({status.lastDetection.keyword})
        </Text>
      ) : null}
      {status.error ? <Text style={styles.error}>{status.error}</Text> : null}

      <View style={styles.diagBox}>
        <Text style={styles.diagTitle}>Audio diagnostics</Text>
        <Text style={styles.diag}>
          Frames: {a.framesReceived} · Last: {a.lastFrameBytes}B / {a.lastFrameSamples} samples
        </Text>
        <Text style={styles.diag}>
          Sample rate: {a.sampleRate} Hz · Buffer: {a.bufferSamples}
        </Text>
        <Text style={styles.diag}>
          RMS: {a.rms.toFixed(4)} · Peak: {a.peak.toFixed(4)}
        </Text>
        <Text style={styles.diag}>
          KWS accepts: {a.kwsAccepts} · Stream: {a.kwsStreamActive ? "active" : "idle"}
          {a.lastKwsKeyword ? ` · Last KW: ${a.lastKwsKeyword}` : ""}
        </Text>
      </View>

      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start Wake Word"
          style={[styles.btn, styles.btnPrimary, listening && styles.btnDisabled]}
          disabled={listening}
          onPress={() => void onStart()}>
          {busy && status.state === "initializing" ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Start Wake Word</Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop"
          style={[styles.btn, styles.btnSecondary, !listening && styles.btnDisabled]}
          disabled={!listening}
          onPress={() => void onStop()}>
          <Text style={styles.btnTextDark}>Stop</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Test WAV Hey Pathu"
        style={[styles.btn, styles.btnWav, busy && styles.btnDisabled]}
        disabled={busy}
        onPress={() => void onWavTest()}>
        <Text style={styles.btnTextDark}>Test WAV (Hey Pathu)</Text>
      </Pressable>
      {__DEV__ ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mic diagnostic"
          style={[styles.btn, styles.btnWav, (busy || diagRunning) && styles.btnDisabled]}
          disabled={busy || diagRunning}
          onPress={() => void onMicDiag()}>
          <Text style={styles.btnTextDark}>
            {diagRunning ? "Recording 5 s… speak now" : "Mic diagnostic (5 s)"}
          </Text>
        </Pressable>
      ) : null}
      {__DEV__ ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="STT only test"
          style={[styles.btn, styles.btnWav, (busy || diagRunning) && styles.btnDisabled]}
          disabled={busy || diagRunning}
          onPress={() => {
            setDiagRunning(true);
            setSttResult("stopping voice controller + KWS…");
            void (async () => {
              try {
                await voiceConversation.stop();
                await new Promise((r) => setTimeout(r, 800));
                const svc = ExpoSpeechRecognitionModule.getDefaultRecognitionService();
                console.log(
                  `[PathuSTT] STT-only test: owner=${micOwnership.owner} available=${ExpoSpeechRecognitionModule.isRecognitionAvailable()} default=${svc?.packageName} services=${ExpoSpeechRecognitionModule.getSpeechRecognitionServices().join(",")}`,
                );
                setSttResult("Listening — say \"Turn on my fan\"");
                const text = await speechRecognition.start();
                setSttResult(`Result: ${text ?? "(none)"}`);
              } catch (e) {
                setSttResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
              } finally {
                setDiagRunning(false);
              }
            })();
          }}>
          <Text style={styles.btnTextDark}>STT only, no KWS (DEV)</Text>
        </Pressable>
      ) : null}
      {sttResult ? <Text style={styles.diag}>{sttResult}</Text> : null}
      {__DEV__ ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resume voice"
          style={[styles.btn, styles.btnWav]}
          onPress={() => void voiceConversation.start()}>
          <Text style={styles.btnTextDark}>Resume voice controller</Text>
        </Pressable>
      ) : null}
      {diag ? (
        <View style={styles.diagBox}>
          <Text style={styles.diag}>
            Chunks {diag.chunks} ({diag.chunkBytesMin}-{diag.chunkBytesMax}B, odd {diag.oddByteChunks}, dup {diag.repeatedChunks}) · samples {diag.samples}/{diag.expectedSamples}
          </Text>
          <Text style={styles.diag}>
            RMS {diag.rms} · peak {diag.peak} · min {diag.min} · max {diag.max} · DC {diag.dcMean}
          </Text>
          <Text style={styles.diag}>
            ZCR {diag.zeroCrossingRate} · near-zero {diag.nearZeroPct}% · clipped {diag.clippedPct}%
          </Text>
          <Text style={styles.diag}>
            Frame RMS min {diag.frameRmsMin} · med {diag.frameRmsMedian} · p90 {diag.frameRmsP90} · max {diag.frameRmsMax} · loud {diag.loudFrames}
          </Text>
          <Text style={styles.diag}>
            Chunk interval ms {diag.chunkIntervalMsMin}/{diag.chunkIntervalMsMedian}/{diag.chunkIntervalMsMax}
          </Text>
          <Text style={styles.detected}>
            Offline KWS on captured audio: {diag.kwsOffline?.detected ? `DETECTED ${diag.kwsOffline.keyword}` : "no detection"}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D5DBE3",
    gap: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F1C2E",
    marginBottom: 4,
  },
  meta: {
    fontSize: 12,
    color: "#4A5562",
  },
  diagBox: {
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#F4F7FA",
    gap: 2,
  },
  diagTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F1C2E",
    marginBottom: 2,
  },
  diag: {
    fontSize: 11,
    color: "#334155",
    fontVariant: ["tabular-nums"],
  },
  detected: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: "700",
    color: "#1B7F4E",
  },
  error: {
    marginTop: 4,
    fontSize: 12,
    color: "#912018",
  },
  row: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  btn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: {
    backgroundColor: "#1F4E79",
  },
  btnSecondary: {
    backgroundColor: "#EEF1F4",
  },
  btnWav: {
    marginTop: 8,
    backgroundColor: "#EEF1F4",
    flex: 0,
  },
  btnDisabled: {
    opacity: 0.45,
  },
  btnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },
  btnTextDark: {
    color: "#0F1C2E",
    fontWeight: "700",
    fontSize: 13,
  },
});
