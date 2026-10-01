import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { chat, getApiBaseUrl, getHealth, PathuApiError } from "@/api/client";
import type { UiMessage } from "@/api/types";
import { VoiceStatusPanel } from "@/voice/VoiceStatusPanel";

type ConnectionState = "checking" | "connected" | "disconnected";

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function PathuChatScreen() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const listRef = useRef<FlatList<UiMessage>>(null);
  const lastVoiceSessionRef = useRef<number | null>(null);

  const refreshHealth = useCallback(async () => {
    try {
      const health = await getHealth();
      if (health.ok) {
        setConnection("connected");
      } else {
        setConnection("disconnected");
      }
    } catch {
      setConnection("disconnected");
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    const id = setInterval(() => {
      void refreshHealth();
    }, 15_000);
    return () => clearInterval(id);
  }, [refreshHealth]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const onVoiceExchange = useCallback(
    (sessionId: number, userText: string, assistantText: string) => {
      if (lastVoiceSessionRef.current === sessionId) return;
      lastVoiceSessionRef.current = sessionId;
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "user", content: userText },
        { id: newId(), role: "assistant", content: assistantText },
      ]);
      setConnection("connected");
      scrollToEnd();
    },
    [scrollToEnd],
  );

  const onSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;

    const userMessage: UiMessage = {
      id: newId(),
      role: "user",
      content: text,
    };

    setDraft("");
    setError(null);
    setSending(true);
    setMessages((prev) => [...prev, userMessage]);
    scrollToEnd();

    try {
      const result = await chat({ message: text });
      const reply =
        typeof result.reply === "string" ? result.reply.trim() : "";
      if (!reply) {
        throw new PathuApiError("Empty reply from Pathu", 502);
      }
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "assistant", content: reply },
      ]);
      setConnection("connected");
      scrollToEnd();
    } catch (err) {
      const message =
        err instanceof PathuApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Request failed";
      setError(message);
      setConnection("disconnected");
    } finally {
      setSending(false);
    }
  }, [draft, sending, scrollToEnd]);

  const statusLabel =
    connection === "checking"
      ? "Checking…"
      : connection === "connected"
        ? "Connected"
        : "Disconnected";

  const statusColor =
    connection === "connected"
      ? "#1B7F4E"
      : connection === "checking"
        ? "#8A7A3A"
        : "#B42318";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}>
        <View style={styles.header}>
          <Text style={styles.brand}>Pathu</Text>
          <Pressable
            onPress={() => void refreshHealth()}
            style={styles.statusPill}
            accessibilityRole="button"
            accessibilityLabel={`Backend ${statusLabel}. Tap to retry.`}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>
              {statusLabel}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.apiHint} numberOfLines={1}>
          {getApiBaseUrl()}
        </Text>

        <VoiceStatusPanel
          connectionLabel={statusLabel}
          connectionColor={statusColor}
          onVoiceExchange={onVoiceExchange}
        />

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => setError(null)} hitSlop={8}>
              <Text style={styles.errorDismiss}>Dismiss</Text>
            </Pressable>
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          style={styles.list}
          contentContainerStyle={[
            styles.listContent,
            messages.length === 0 ? styles.listEmpty : null,
          ]}
          data={messages}
          keyExtractor={(item) => item.id}
          onContentSizeChange={scrollToEnd}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Hi — I'm Pathu</Text>
              <Text style={styles.emptyBody}>
                Say "Hey Pathu", then give a command — or type below. Backend
                is on this PC over USB.
              </Text>
              {connection === "disconnected" ? (
                <Text style={styles.emptyWarn}>
                  Backend unreachable. Keep Pathu running on port 3001 and use
                  npm run dev:android so adb reverse is set.
                </Text>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === "user" ? styles.bubbleUser : styles.bubbleAssistant,
              ]}>
              <Text
                style={[
                  styles.bubbleRole,
                  item.role === "user"
                    ? styles.bubbleRoleUser
                    : styles.bubbleRoleAssistant,
                ]}>
                {item.role === "user" ? "You" : "Pathu"}
              </Text>
              <Text
                style={[
                  styles.bubbleText,
                  item.role === "user"
                    ? styles.bubbleTextUser
                    : styles.bubbleTextAssistant,
                ]}>
                {item.content}
              </Text>
            </View>
          )}
          ListFooterComponent={
            sending ? (
              <View style={styles.thinking}>
                <ActivityIndicator color="#1F4E79" />
                <Text style={styles.thinkingText}>Pathu is thinking…</Text>
              </View>
            ) : null
          }
        />

        <View style={styles.composer}>
          <Pressable
            style={styles.micBtn}
            onPress={() => {
              // VoiceStatusPanel owns the controller; this mirrors Mic for reachability.
              void import("@/voice/VoiceConversationController").then(
                ({ voiceConversation }) =>
                  voiceConversation.startManualCommand(),
              );
            }}
            accessibilityRole="button"
            accessibilityLabel="Start voice command">
            <Text style={styles.micIcon}>Mic</Text>
          </Pressable>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message Pathu…"
            placeholderTextColor="#8A9099"
            editable={!sending}
            multiline
            maxLength={2000}
            returnKeyType="send"
            blurOnSubmit
            onSubmitEditing={() => {
              void onSend();
            }}
          />
          <Pressable
            style={[
              styles.sendBtn,
              (!draft.trim() || sending) && styles.sendBtnDisabled,
            ]}
            disabled={!draft.trim() || sending}
            onPress={() => void onSend()}
            accessibilityRole="button"
            accessibilityLabel="Send message">
            <Text style={styles.sendLabel}>{sending ? "…" : "Send"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F4F6F8",
  },
  flex: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    fontSize: 28,
    fontWeight: "700",
    color: "#0F1C2E",
    letterSpacing: -0.5,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D5DBE3",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    fontWeight: "600",
  },
  apiHint: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    fontSize: 11,
    color: "#8A9099",
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#FCEBEA",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  errorText: {
    flex: 1,
    color: "#912018",
    fontSize: 13,
  },
  errorDismiss: {
    color: "#912018",
    fontWeight: "700",
    fontSize: 13,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  listEmpty: {
    flexGrow: 1,
    justifyContent: "center",
  },
  empty: {
    paddingVertical: 32,
    paddingHorizontal: 8,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0F1C2E",
  },
  emptyBody: {
    fontSize: 15,
    lineHeight: 22,
    color: "#4A5562",
  },
  emptyWarn: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    color: "#912018",
  },
  bubble: {
    maxWidth: "88%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "#1F4E79",
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D5DBE3",
  },
  bubbleRole: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  bubbleRoleUser: {
    color: "rgba(255,255,255,0.75)",
  },
  bubbleRoleAssistant: {
    color: "#6B7280",
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 22,
  },
  bubbleTextUser: {
    color: "#FFFFFF",
  },
  bubbleTextAssistant: {
    color: "#111827",
  },
  thinking: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  thinkingText: {
    color: "#4A5562",
    fontSize: 14,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: Platform.OS === "android" ? 12 : 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#D5DBE3",
    backgroundColor: "#FFFFFF",
  },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#1F4E79",
    alignItems: "center",
    justifyContent: "center",
  },
  micIcon: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    backgroundColor: "#F4F6F8",
    color: "#111827",
    fontSize: 16,
  },
  sendBtn: {
    minWidth: 64,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#1F4E79",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
  sendLabel: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
});
