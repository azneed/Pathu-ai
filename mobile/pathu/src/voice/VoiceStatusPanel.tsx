import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { voiceConversation } from "@/voice/VoiceConversationController";
import type { VoiceConversationStatus } from "@/voice/types";
import {
  wakeForegroundService,
  type WakeFgsSnapshot,
} from "@/wakeword/WakeForegroundService";
import { WakeWordTestPanel } from "@/wakeword/WakeWordTestPanel";
import { sherpaWakeWord } from "@/wakeword/SherpaWakeWord";
import type { WakeWordStatus } from "@/wakeword/types";

type Props = {
  connectionLabel: string;
  connectionColor: string;
  onVoiceExchange?: (
    sessionId: number,
    userText: string,
    assistantText: string,
  ) => void;
};

/**
 * Foreground voice conversation status (Phase 7 · voice loop).
 */
export function VoiceStatusPanel({
  connectionLabel,
  connectionColor,
  onVoiceExchange,
}: Props) {
  const [status, setStatus] = useState<VoiceConversationStatus>(
    voiceConversation.getStatus(),
  );
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showVoiceDiag, setShowVoiceDiag] = useState(false);
  const [fgs, setFgs] = useState<WakeFgsSnapshot>(wakeForegroundService.getStatus());
  const [wake, setWake] = useState<WakeWordStatus>(sherpaWakeWord.getStatus());

  useEffect(() => {
    const unsubscribe = voiceConversation.subscribe(setStatus);
    const unsubFgs = wakeForegroundService.subscribe(setFgs);
    const unsubWake = sherpaWakeWord.subscribe(setWake);
    void voiceConversation.start();
    return () => {
      unsubscribe();
      unsubFgs();
      unsubWake();
      void voiceConversation.stop();
    };
  }, []);

  useEffect(() => {
    if (
      (status.phase === "speaking" || status.phase === "wake_listening") &&
      status.transcript &&
      status.reply &&
      onVoiceExchange
    ) {
      onVoiceExchange(status.sessionId, status.transcript, status.reply);
    }
  }, [
    status.phase,
    status.sessionId,
    status.transcript,
    status.reply,
    onVoiceExchange,
  ]);

  const listeningCommand = status.phase === "command_listening";
  const busy =
    status.phase === "command_listening" ||
    status.phase === "processing" ||
    status.phase === "speaking";

  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <Text style={styles.title}>Voice</Text>
        <Text style={[styles.conn, { color: connectionColor }]}>
          {connectionLabel}
        </Text>
      </View>

      <Text style={styles.stateLabel}>{status.uiLabel}</Text>
      {status.phase === "command_listening" ? (
        <Text style={styles.hint}>I'm listening…</Text>
      ) : null}

      {status.partialTranscript || status.transcript ? (
        <Text style={styles.line}>
          You: {status.partialTranscript || status.transcript}
        </Text>
      ) : null}
      {status.reply ? (
        <Text style={styles.line}>Pathu: {status.reply}</Text>
      ) : null}
      {status.error ? (
        <Text style={styles.error}>Error: {status.error}</Text>
      ) : null}

      <Text style={styles.meta}>
        STT: {status.sttMode}
        {status.sttMode === "system"
          ? " (may use remote recognition)"
          : status.sttMode === "on-device"
            ? " (on-device preferred)"
            : ""}
      </Text>
      <Text style={styles.meta}>
        Wake FGS: {fgs.state}
        {fgs.active ? " · active" : ""} · screen: {fgs.lastScreenEvent}
      </Text>
      {wake.lastDetection ? (
        <Text style={styles.meta}>
          Last wake: {wake.lastDetection.keyword} (
          {new Date(wake.lastDetection.at).toLocaleTimeString()}) · count{" "}
          {wake.detectionCount}
        </Text>
      ) : null}
      {fgs.lastError ? (
        <Text style={styles.error}>FGS: {fgs.lastError}</Text>
      ) : null}
      {fgs.oemHint ? (
        <Text style={styles.meta}>OEM: {fgs.oemHint} · SDK {fgs.sdkInt}</Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          style={[styles.btn, busy && !listeningCommand && styles.btnDisabled]}
          disabled={busy && !listeningCommand}
          onPress={() => void voiceConversation.startManualCommand()}
          accessibilityRole="button"
          accessibilityLabel="Start voice command">
          <Text style={styles.btnText}>Mic</Text>
        </Pressable>
        {listeningCommand ? (
          <Pressable
            style={[styles.btn, styles.btnStop]}
            onPress={() => void voiceConversation.cancelCommand()}
            accessibilityRole="button"
            accessibilityLabel="Cancel listening">
            <Text style={styles.btnText}>Stop</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.linkBtn}
          onPress={() => setShowVoiceDiag((v) => !v)}
          accessibilityRole="button">
          <Text style={styles.linkText}>
            {showVoiceDiag ? "Hide voice log" : "Voice log"}
          </Text>
        </Pressable>
        <Pressable
          style={styles.linkBtn}
          onPress={() => setShowDiagnostics((v) => !v)}
          accessibilityRole="button">
          <Text style={styles.linkText}>
            {showDiagnostics ? "Hide diagnostics" : "Diagnostics"}
          </Text>
        </Pressable>
        {__DEV__ ? (
          <Pressable
            style={styles.linkBtn}
            disabled={busy}
            onPress={() =>
              void voiceConversation.startFileCommand(
                "file:///sdcard/Android/data/com.anonymous.pathu/files/turn_on_my_fan_16k.wav",
              )
            }
            accessibilityRole="button"
            accessibilityLabel="STT file test">
            <Text style={styles.linkText}>STT file test</Text>
          </Pressable>
        ) : null}
      </View>

      {showVoiceDiag ? (
        <View style={styles.diagBox}>
          {status.diagnostics.length === 0 ? (
            <Text style={styles.meta}>No events yet</Text>
          ) : (
            status.diagnostics.slice(0, 10).map((event) => (
              <Text key={`${event.at}-${event.message}`} style={styles.diagLine}>
                {new Date(event.at).toLocaleTimeString()} · {event.message}
              </Text>
            ))
          )}
        </View>
      ) : null}

      {showDiagnostics ? (
        <View style={styles.wakeWrap}>
          <WakeWordTestPanel />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D5DBE3",
    gap: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F1C2E",
  },
  conn: {
    fontSize: 12,
    fontWeight: "600",
  },
  stateLabel: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1F4E79",
  },
  hint: {
    fontSize: 14,
    color: "#4A5562",
  },
  line: {
    fontSize: 14,
    lineHeight: 20,
    color: "#111827",
  },
  error: {
    fontSize: 13,
    color: "#912018",
  },
  meta: {
    fontSize: 11,
    color: "#6B7280",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  btn: {
    minWidth: 56,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#1F4E79",
    alignItems: "center",
    justifyContent: "center",
  },
  btnStop: {
    backgroundColor: "#912018",
  },
  btnDisabled: {
    opacity: 0.45,
  },
  btnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },
  linkBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  linkText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1F4E79",
  },
  diagBox: {
    marginTop: 4,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#F4F6F8",
    gap: 2,
  },
  diagLine: {
    fontSize: 10,
    color: "#4A5562",
    fontFamily: "monospace",
  },
  wakeWrap: {
    marginTop: 6,
    marginHorizontal: -4,
  },
});
