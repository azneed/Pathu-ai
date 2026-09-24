import type { ChatMessage } from "./types.js";

/** Keep enough recent turns for pronoun resolution without unbounded growth. */
export const MAX_HISTORY_MESSAGES = 60;

/**
 * Take the newest messages, but never start mid tool-exchange
 * (a tool result without its preceding assistant tool call).
 */
export function selectRecentHistory(
  history: ChatMessage[],
  limit = MAX_HISTORY_MESSAGES,
): ChatMessage[] {
  if (history.length <= limit) {
    return history;
  }

  let start = history.length - limit;
  while (start < history.length && history[start]?.role === "tool") {
    start += 1;
  }

  // If trimming left a dangling assistant tool-call without following tools
  // at the window edge, that is fine — the next user message still has context.
  return history.slice(start);
}
