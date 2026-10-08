import type { Db } from "../db/index.js";
import {
  DEVICE_IDS,
  type DeviceGateway,
  type DeviceSnapshot,
} from "../devices/types.js";
import type { ClientAction } from "../youtube/clientActions.js";
import { parseClientAction } from "../youtube/clientActions.js";
import { detectFastDeviceAction, runFastDeviceAction } from "./fastDeviceAction.js";
import { selectRecentHistory } from "./history.js";
import { buildSystemPrompt, formatDeviceStateContext } from "./prompt.js";
import type { ChatMessage, LLMProvider } from "./types.js";
import { executeTool, toolDefinitions } from "./tools.js";

const DEFAULT_SESSION_ID = "default";
const MAX_TOOL_ROUNDS = 5;

/** Tools after which the device snapshot is re-read (even on failure: a step may have applied). */
const STATE_CHANGING_TOOLS = new Set(["set_ac", "set_fan", "set_lights", "set_rgb", "run_routine"]);

export interface ChatResult {
  reply: string;
  /** Devices that could not be read are `{ status: "unavailable" }`. */
  devices: DeviceSnapshot;
  toolTrace: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    error?: string;
  }>;
  /** Last provider that successfully answered in this turn (if known). */
  provider?: string;
  /** Upstream model id when reported by the provider. */
  model?: string;
  /** Safe browser-side YouTube / Audius player commands only. */
  clientActions?: ClientAction[];
}

function extractClientAction(result: unknown): ClientAction | null {
  if (!result || typeof result !== "object") return null;
  const maybe = (result as { clientAction?: unknown }).clientAction;
  if (!maybe) return null;
  return parseClientAction(maybe);
}

/** A device backend failure must not fail the chat turn: unreadable devices become unavailable. */
async function readDeviceSnapshot(gateway: DeviceGateway): Promise<DeviceSnapshot> {
  try {
    return await gateway.getAll();
  } catch {
    console.warn("[chat] device snapshot failed; continuing with all devices unavailable");
    const snapshot = {} as DeviceSnapshot;
    for (const id of DEVICE_IDS) snapshot[id] = { status: "unavailable" };
    return snapshot;
  }
}

function buildProviderMessages(options: {
  devices: DeviceSnapshot;
  history: ChatMessage[];
  userMessage: ChatMessage;
  inTurn: ChatMessage[];
  timeZone: string;
}): ChatMessage[] {
  return [
    { role: "system", content: buildSystemPrompt(options.timeZone) },
    {
      role: "system",
      content: formatDeviceStateContext(options.devices),
    },
    ...selectRecentHistory(options.history),
    options.userMessage,
    ...options.inTurn,
  ];
}

export async function runChat(options: {
  message: string;
  provider: LLMProvider;
  gateway: DeviceGateway;
  db: Db;
  sessionId?: string;
  timeZone?: string;
  now?: () => Date;
  youtubeApiKey?: string;
  audiusApiKey?: string;
}): Promise<ChatResult> {
  const sessionId = options.sessionId ?? DEFAULT_SESSION_ID;
  const timeZone =
    options.timeZone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC";
  const toolTrace: ChatResult["toolTrace"] = [];
  const clientActions: ClientAction[] = [];
  let lastProvider: string | undefined;
  let lastModel: string | undefined;
  let persistedUser = false;

  const history = options.db.getMessages(sessionId);
  const userMessage: ChatMessage = { role: "user", content: options.message };
  const inTurn: ChatMessage[] = [];

  const persistUserOnce = () => {
    if (!persistedUser) {
      options.db.appendMessage(sessionId, userMessage);
      persistedUser = true;
    }
  };

  const toolContext = {
    gateway: options.gateway,
    tasks: options.db.tasks,
    routines: options.db.routines,
    timeZone,
    sessionId,
    now: options.now,
    youtubeApiKey: options.youtubeApiKey ?? "",
    audiusApiKey: options.audiusApiKey ?? "",
  };

  const fastAction = detectFastDeviceAction(options.message);
  if (fastAction) {
    console.log(
      `[chat] fast device action: ${fastAction.tool} ${fastAction.deviceId} power=${fastAction.power}`,
    );
    return runFastDeviceAction(fastAction, {
      provider: options.provider,
      toolContext,
      history,
      userMessage,
      timeZone,
      readSnapshot: () => readDeviceSnapshot(options.gateway),
      persist: (message) => options.db.appendMessage(sessionId, message),
    });
  }

  let devices = await readDeviceSnapshot(options.gateway);

  const finish = (reply: string): ChatResult => {
    const result: ChatResult = {
      reply,
      devices,
      toolTrace,
      provider: lastProvider,
      model: lastModel,
    };
    if (clientActions.length > 0) {
      result.clientActions = clientActions;
    }
    return result;
  };

  let rounds = 0;
  while (rounds < MAX_TOOL_ROUNDS) {
    rounds += 1;

    const providerMessages = buildProviderMessages({
      devices,
      history,
      userMessage,
      inTurn,
      timeZone,
    });

    const llmResult = await options.provider.chat({
      messages: providerMessages,
      tools: toolDefinitions,
    });

    persistUserOnce();

    const { assistantMessage } = llmResult;
    if (llmResult.provider) {
      lastProvider = llmResult.provider;
    }
    if (llmResult.model) {
      lastModel = llmResult.model;
    }

    options.db.appendMessage(sessionId, assistantMessage);
    inTurn.push(assistantMessage);

    const toolCalls = assistantMessage.toolCalls ?? [];
    if (toolCalls.length === 0) {
      return finish(assistantMessage.content?.trim() || "Done.");
    }

    let devicesStale = false;
    for (const call of toolCalls) {
      if (STATE_CHANGING_TOOLS.has(call.name)) {
        devicesStale = true;
      }
      try {
        const result = await executeTool(call.name, call.arguments, toolContext);
        if (call.name === "get_devices") {
          devices = result as DeviceSnapshot;
        }
        toolTrace.push({
          name: call.name,
          arguments: call.arguments,
          result,
        });
        const action = extractClientAction(result);
        if (action) {
          clientActions.push(action);
        }
        const toolMessage: ChatMessage = {
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          content: JSON.stringify(result),
        };
        options.db.appendMessage(sessionId, toolMessage);
        inTurn.push(toolMessage);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        toolTrace.push({
          name: call.name,
          arguments: call.arguments,
          error: errorMessage,
        });
        const toolMessage: ChatMessage = {
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          content: JSON.stringify({ error: errorMessage }),
        };
        options.db.appendMessage(sessionId, toolMessage);
        inTurn.push(toolMessage);
      }
    }
    if (devicesStale) {
      devices = await readDeviceSnapshot(options.gateway);
    }
  }

  return finish(
    "I had trouble completing that request after several tool steps.",
  );
}
