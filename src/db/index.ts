import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { ChatMessage, ToolCall } from "../ai/types.js";
import type { DeviceId, DeviceState } from "../devices/types.js";
import { createTaskService, type TaskService } from "../tasks/service.js";
import { prepareTaskStatements } from "../tasks/store.js";
import {
  createRoutineService,
  type RoutineService,
} from "../routines/service.js";
import { prepareRoutineStatements } from "../routines/store.js";

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");

export interface Db {
  getMessages(sessionId: string): ChatMessage[];
  appendMessage(sessionId: string, message: ChatMessage): void;
  clearMessages(sessionId: string): void;
  getDeviceState(deviceId: DeviceId): DeviceState | null;
  setDeviceState(deviceId: DeviceId, state: DeviceState): void;
  getAllDeviceStates(): Partial<Record<DeviceId, DeviceState>>;
  /** Task persistence + execution helpers bound to this DB. */
  tasks: TaskService;
  /** Named device-action routines/scenes. */
  routines: RoutineService;
  close(): void;
}

export function openDb(
  databasePath: string,
  options?: {
    timeZone?: string;
    now?: () => Date;
    onTasksChanged?: () => void;
  },
): Db {
  mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec(readFileSync(SCHEMA_PATH, "utf8"));

  const insertMessage = sqlite.prepare(`
    INSERT INTO messages (session_id, role, content, tool_call_id, tool_name, tool_calls_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const selectMessages = sqlite.prepare(`
    SELECT role, content, tool_call_id, tool_name, tool_calls_json
    FROM messages
    WHERE session_id = ?
    ORDER BY id ASC
  `);

  const selectDevice = sqlite.prepare(`
    SELECT state_json FROM device_state WHERE device_id = ?
  `);

  const upsertDevice = sqlite.prepare(`
    INSERT INTO device_state (device_id, state_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(device_id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = datetime('now')
  `);

  const selectAllDevices = sqlite.prepare(`
    SELECT device_id, state_json FROM device_state
  `);

  const deleteMessages = sqlite.prepare(`
    DELETE FROM messages WHERE session_id = ?
  `);

  const taskStmts = prepareTaskStatements(sqlite);
  const tasks = createTaskService({
    stmts: taskStmts,
    timeZone: options?.timeZone ?? "UTC",
    now: options?.now,
    onChange: options?.onTasksChanged,
  });

  const routineStmts = prepareRoutineStatements(sqlite);
  const routines = createRoutineService({
    stmts: routineStmts,
    now: options?.now,
  });

  return {
    tasks,
    routines,

    getMessages(sessionId) {
      const rows = selectMessages.all(sessionId) as Array<{
        role: string;
        content: string | null;
        tool_call_id: string | null;
        tool_name: string | null;
        tool_calls_json: string | null;
      }>;

      const messages: ChatMessage[] = [];
      for (const row of rows) {
        if (row.role === "user") {
          messages.push({ role: "user", content: row.content ?? "" });
          continue;
        }
        if (row.role === "tool") {
          messages.push({
            role: "tool",
            content: row.content ?? "",
            toolCallId: row.tool_call_id ?? "",
            toolName: row.tool_name ?? undefined,
          });
          continue;
        }
        if (row.role === "assistant") {
          const toolCalls = row.tool_calls_json
            ? (JSON.parse(row.tool_calls_json) as ToolCall[])
            : undefined;
          messages.push({
            role: "assistant",
            content: row.content,
            toolCalls,
          });
        }
      }
      return messages;
    },

    appendMessage(sessionId, message) {
      if (message.role === "system") {
        return;
      }

      if (message.role === "user") {
        insertMessage.run(
          sessionId,
          "user",
          message.content,
          null,
          null,
          null,
        );
        return;
      }

      if (message.role === "tool") {
        insertMessage.run(
          sessionId,
          "tool",
          message.content,
          message.toolCallId,
          message.toolName ?? null,
          null,
        );
        return;
      }

      insertMessage.run(
        sessionId,
        "assistant",
        message.content,
        null,
        null,
        message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      );
    },

    clearMessages(sessionId) {
      deleteMessages.run(sessionId);
    },

    getDeviceState(deviceId) {
      const row = selectDevice.get(deviceId) as
        | { state_json: string }
        | undefined;
      if (!row) return null;
      return JSON.parse(row.state_json) as DeviceState;
    },

    setDeviceState(deviceId, state) {
      upsertDevice.run(deviceId, JSON.stringify(state));
    },

    getAllDeviceStates() {
      const rows = selectAllDevices.all() as Array<{
        device_id: string;
        state_json: string;
      }>;
      const result: Partial<Record<DeviceId, DeviceState>> = {};
      for (const row of rows) {
        result[row.device_id as DeviceId] = JSON.parse(
          row.state_json,
        ) as DeviceState;
      }
      return result;
    },

    close() {
      sqlite.close();
    },
  };
}
