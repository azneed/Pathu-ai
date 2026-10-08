import { DeviceCommandError, DeviceUnavailableError } from "../devices/errors.js";
import { HomeAssistantError } from "../devices/homeassistant/client.js";
import { isDeviceId, type DeviceId, type DeviceSnapshot } from "../devices/types.js";
import type { ChatResult } from "./chat.js";
import { setAcSchema } from "./deviceActions.js";
import { selectRecentHistory } from "./history.js";
import { buildSystemPrompt, formatDeviceStateContext } from "./prompt.js";
import { executeTool, type ToolContext } from "./tools.js";
import type { ChatMessage, LLMProvider } from "./types.js";

/**
 * Fast path for simple, unambiguous AC power commands ("turn off the hall AC"): the action runs
 * through the normal set_ac tool without an LLM tool-selection round, then the LLM (tools disabled)
 * only phrases the reply. Anything else returns null and goes through the regular tool loop.
 */

export interface FastDeviceAction {
  tool: "set_ac";
  deviceId: DeviceId;
  power: "on" | "off";
  arguments: { device: DeviceId; power: "on" | "off" };
}

const LEADING_FILLER =
  /^(?:(?:hey|ok|okay)\s+pathu|pathu|please|kindly|can you|could you|would you|will you)\s+/;
const TRAILING_FILLER = /\s+(?:please|now|right now|for me|thanks|thank you)$/;

const VERB = "(?:turn|switch|power)";
const DETERMINER = "(?:(?:the|my)\\s+)?";
const ROOM = "([a-z]+)";
const VERB_POWER_DEVICE = new RegExp(`^${VERB}\\s+(on|off)\\s+${DETERMINER}${ROOM}\\s+ac$`);
const VERB_DEVICE_POWER = new RegExp(`^${VERB}\\s+${DETERMINER}${ROOM}\\s+ac\\s+(on|off)$`);

function normalize(message: string): string {
  let text = message
    .toLowerCase()
    .replace(/\ba\s*\/\s*c\b/g, "ac")
    .replace(/\ba\.c\.?/g, "ac")
    .replace(/\bair[\s-]?condition(?:er|ing)\b/g, "ac")
    .replace(/\baircon\b/g, "ac")
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (let previous = ""; previous !== text; ) {
    previous = text;
    text = text.replace(LEADING_FILLER, "").replace(TRAILING_FILLER, "");
  }
  return text;
}

/**
 * The whole message must be exactly one AC power command naming a room with a known AC.
 * "turn on the AC" (two ACs exist), extra clauses, delays, or settings are not matched.
 */
export function detectFastDeviceAction(message: string): FastDeviceAction | null {
  const text = normalize(message);

  let room: string | undefined;
  let power: string | undefined;
  const powerFirst = VERB_POWER_DEVICE.exec(text);
  const deviceFirst = VERB_DEVICE_POWER.exec(text);
  if (powerFirst) {
    [, power, room] = powerFirst;
  } else if (deviceFirst) {
    [, room, power] = deviceFirst;
  } else {
    return null;
  }

  const deviceId = `${room}.ac`;
  if (!isDeviceId(deviceId) || (power !== "on" && power !== "off")) return null;

  const args = { device: deviceId, power } as const;
  if (!setAcSchema.safeParse(args).success) return null;

  return { tool: "set_ac", deviceId, power, arguments: { ...args } };
}

export function deviceDisplayName(deviceId: DeviceId): string {
  const [room = deviceId] = deviceId.split(".");
  return `${room.charAt(0).toUpperCase()}${room.slice(1)} AC`;
}

interface ReportedAcState {
  power?: unknown;
  powerStateUnconfirmed?: unknown;
}

function reportedState(result: unknown): ReportedAcState {
  return result && typeof result === "object" ? (result as ReportedAcState) : {};
}

/** Truthful reply used whenever the LLM cannot phrase one after a successful action. */
export function deterministicSuccessReply(action: FastDeviceAction, result: unknown): string {
  const name = deviceDisplayName(action.deviceId);
  const state = reportedState(result);
  if (state.powerStateUnconfirmed === true) {
    return `Done. I've sent the power command to the ${name}.`;
  }
  if (state.power === action.power) {
    return `Done. The ${name} is now ${action.power}.`;
  }
  return `I sent the command to turn the ${name} ${action.power}, but it currently reports ${String(state.power ?? "an unknown state")}.`;
}

/** Device/Home Assistant errors carry safe messages; anything else is not shown. */
function failureReason(action: FastDeviceAction, error: unknown): string | undefined {
  const name = deviceDisplayName(action.deviceId);
  if (error instanceof DeviceUnavailableError) {
    return `The ${name} is unavailable right now.`;
  }
  if (error instanceof DeviceCommandError || error instanceof HomeAssistantError) {
    const reason = error.message.replace(`${action.deviceId}: `, "");
    return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
  }
  return undefined;
}

export function failureReply(action: FastDeviceAction, error: unknown): string {
  const name = deviceDisplayName(action.deviceId);
  const reason = failureReason(action, error);
  return `Sorry, I couldn't send the power-${action.power} command to the ${name}.${reason ? ` ${reason}` : ""}`;
}

/** Text-only history: without tool declarations, replayed tool calls/results are not valid input. */
function textOnlyHistory(history: ChatMessage[]): ChatMessage[] {
  return selectRecentHistory(history).flatMap((message): ChatMessage[] => {
    if (message.role === "user") return [message];
    if (message.role === "assistant" && message.content?.trim()) {
      return [{ role: "assistant", content: message.content }];
    }
    return [];
  });
}

function postActionInstruction(action: FastDeviceAction, result: unknown): string {
  const name = deviceDisplayName(action.deviceId);
  const unconfirmed = reportedState(result).powerStateUnconfirmed === true;
  const details = unconfirmed
    ? [
        `- Action: the requested power-${action.power} command for the ${name} was sent as an IR power signal.`,
        "- Result: the IR signal was sent successfully.",
        `- Physical power state: unconfirmed (single-button IR toggle with no state feedback). Say the power command was sent; do NOT claim the ${name} is now physically on or off.`,
      ]
    : [
        `- Action: set_ac ${JSON.stringify(action.arguments)}`,
        "- Result: success",
        `- Reported device state: ${JSON.stringify(result)}`,
        "- Describe the outcome only from the reported device state.",
      ];
  return [
    "DEVICE ACTION ALREADY EXECUTED (tools are disabled for this reply):",
    "Pathu has already carried out the user's latest message.",
    ...details,
    "Reply with one short, natural sentence suitable for speaking aloud. Do not mention tools or device IDs, and do not offer to repeat the action.",
  ].join("\n");
}

/** Unconfirmed IR devices report placeholder power/settings; only the unconfirmed flag is meaningful. */
function withoutUnconfirmedPlaceholders(devices: DeviceSnapshot): DeviceSnapshot {
  const redacted = { ...devices };
  for (const id of Object.keys(redacted) as DeviceId[]) {
    if (reportedState(redacted[id]).powerStateUnconfirmed === true) {
      redacted[id] = { powerStateUnconfirmed: true } as unknown as DeviceSnapshot[DeviceId];
    }
  }
  return redacted;
}

export interface FastDeviceActionContext {
  provider: LLMProvider;
  toolContext: ToolContext;
  history: ChatMessage[];
  userMessage: ChatMessage;
  timeZone: string;
  readSnapshot: () => Promise<DeviceSnapshot>;
  persist: (message: ChatMessage) => void;
}

export async function runFastDeviceAction(
  action: FastDeviceAction,
  ctx: FastDeviceActionContext,
): Promise<ChatResult> {
  const toolTrace: ChatResult["toolTrace"] = [];
  const finish = (reply: string, devices: DeviceSnapshot, extra: Partial<ChatResult> = {}) => {
    ctx.persist(ctx.userMessage);
    ctx.persist({ role: "assistant", content: reply });
    return { reply, devices, toolTrace, ...extra };
  };

  let result: unknown;
  try {
    result = await executeTool(action.tool, action.arguments, ctx.toolContext);
    toolTrace.push({ name: action.tool, arguments: action.arguments, result });
  } catch (error) {
    toolTrace.push({
      name: action.tool,
      arguments: action.arguments,
      error: error instanceof Error ? error.message : String(error),
    });
    return finish(failureReply(action, error), await ctx.readSnapshot());
  }

  const devices = await ctx.readSnapshot();
  try {
    const llmResult = await ctx.provider.chat({
      messages: [
        { role: "system", content: buildSystemPrompt(ctx.timeZone) },
        { role: "system", content: formatDeviceStateContext(withoutUnconfirmedPlaceholders(devices)) },
        ...textOnlyHistory(ctx.history),
        ctx.userMessage,
        { role: "system", content: postActionInstruction(action, result) },
      ],
      tools: [],
    });
    const text = llmResult.assistantMessage.content?.trim();
    if (text && !llmResult.assistantMessage.toolCalls?.length) {
      return finish(text, devices, { provider: llmResult.provider, model: llmResult.model });
    }
    console.warn("[chat] post-action reply was empty; using deterministic reply");
  } catch {
    console.warn("[chat] post-action reply failed; using deterministic reply");
  }
  return finish(deterministicSuccessReply(action, result), devices);
}
