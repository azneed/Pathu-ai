import { describe, expect, it } from "vitest";
import { selectRecentHistory } from "../src/ai/history.js";
import type { ChatMessage } from "../src/ai/types.js";

describe("selectRecentHistory", () => {
  it("returns all messages when under the limit", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ];
    expect(selectRecentHistory(history, 10)).toEqual(history);
  });

  it("keeps the newest messages and avoids starting on a tool result", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "old" },
      { role: "assistant", content: "old reply" },
      { role: "user", content: "set ac" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          { id: "1", name: "set_ac", arguments: { temperature: 22 } },
        ],
      },
      {
        role: "tool",
        toolCallId: "1",
        toolName: "set_ac",
        content: "{}",
      },
      { role: "assistant", content: "done" },
      { role: "user", content: "cooler" },
    ];

    // Limit that would otherwise start on the tool message.
    const selected = selectRecentHistory(history, 4);
    expect(selected[0]?.role).not.toBe("tool");
    expect(selected[selected.length - 1]).toEqual({
      role: "user",
      content: "cooler",
    });
  });
});
