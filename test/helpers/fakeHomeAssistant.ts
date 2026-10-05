import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimal in-process Home Assistant REST API (GET /api/states[/<id>], POST /api/services/...)
 * with bearer auth, simple service semantics and fault injection. Tests talk to it over real HTTP
 * through the real HomeAssistantClient, so timeouts, bodies and status codes are genuine.
 */

export interface FakeEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: Record<string, unknown> | undefined;
}

export type Fault =
  | { type: "status"; status: number; body?: string }
  | { type: "delay"; ms: number }
  | { type: "stall_body" }
  | { type: "raw"; body: string };

interface FaultRule {
  match: (request: RecordedRequest) => boolean;
  fault: Fault;
  remaining: number;
}

export interface FakeHomeAssistant {
  url: string;
  token: string;
  requests: RecordedRequest[];
  entities: Map<string, FakeEntity>;
  addFault(match: string | ((request: RecordedRequest) => boolean), fault: Fault, times?: number): void;
  close(): Promise<void>;
}

export const FAKE_HA_TOKEN = "fake-ha-token-do-not-leak-1234567890";

/** Climate: TARGET_TEMPERATURE | FAN_MODE | TURN_OFF (no TURN_ON). */
export const CLIMATE_FEATURES_NO_TURN_ON = 1 | 8 | 128;

export function defaultEntities(): FakeEntity[] {
  return [
    {
      entity_id: "climate.bedroom_ac",
      state: "off",
      attributes: {
        hvac_modes: ["off", "cool", "heat", "fan_only", "dry"],
        fan_modes: ["auto", "low", "medium", "high"],
        fan_mode: "auto",
        temperature: 24,
        current_temperature: 29,
        supported_features: CLIMATE_FEATURES_NO_TURN_ON,
      },
    },
    {
      entity_id: "fan.bedroom_fan",
      state: "off",
      attributes: { percentage: 0, supported_features: 1 | 16 | 32 },
    },
    {
      entity_id: "light.bedroom_lights",
      state: "off",
      attributes: { brightness: null, supported_color_modes: ["brightness"] },
    },
    {
      entity_id: "light.bedroom_rgb",
      state: "off",
      attributes: { brightness: null, rgb_color: null, supported_color_modes: ["rgb"] },
    },
    { entity_id: "sensor.unrelated", state: "12", attributes: {} },
  ];
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

/** Applies a service call like HA would; returns an error message for invalid calls. */
function applyService(
  entity: FakeEntity,
  domain: string,
  service: string,
  data: Record<string, unknown>,
): string | null {
  const attrs = entity.attributes;
  const features = typeof attrs.supported_features === "number" ? attrs.supported_features : 0;
  switch (`${domain}.${service}`) {
    case "climate.turn_on":
      if (!(features & 256)) return "Entity does not support turn_on";
      entity.state = "cool";
      return null;
    case "climate.turn_off":
      entity.state = "off";
      return null;
    case "climate.set_hvac_mode": {
      const mode = String(data.hvac_mode);
      if (!(attrs.hvac_modes as string[]).includes(mode)) return `Invalid hvac_mode ${mode}`;
      entity.state = mode;
      return null;
    }
    case "climate.set_temperature":
      attrs.temperature = data.temperature;
      return null;
    case "climate.set_fan_mode": {
      const mode = String(data.fan_mode);
      if (!(attrs.fan_modes as string[]).includes(mode)) return `Invalid fan_mode ${mode}`;
      attrs.fan_mode = mode;
      return null;
    }
    case "fan.turn_on":
      if (data.percentage !== undefined) {
        if (!(features & 1)) return "Entity does not support percentage";
        attrs.percentage = data.percentage;
      }
      entity.state = "on";
      return null;
    case "fan.turn_off":
      entity.state = "off";
      attrs.percentage = 0;
      return null;
    case "light.turn_on":
      entity.state = "on";
      if (data.brightness !== undefined) attrs.brightness = data.brightness;
      else if (attrs.brightness === null) attrs.brightness = 255;
      if (data.rgb_color !== undefined) attrs.rgb_color = data.rgb_color;
      return null;
    case "light.turn_off":
      entity.state = "off";
      attrs.brightness = null;
      if ("rgb_color" in attrs) attrs.rgb_color = null;
      return null;
    default:
      return `Service ${domain}.${service} not found`;
  }
}

export async function startFakeHomeAssistant(
  entities: FakeEntity[] = defaultEntities(),
): Promise<FakeHomeAssistant> {
  const state = new Map(entities.map((entity) => [entity.entity_id, structuredClone(entity)]));
  const requests: RecordedRequest[] = [];
  const faults: FaultRule[] = [];

  const server = createServer(async (req, res) => {
    const rawBody = await readBody(req);
    const path = req.url ?? "/";
    const request: RecordedRequest = {
      method: req.method ?? "GET",
      path,
      authorization: req.headers.authorization,
      body: rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : undefined,
    };
    requests.push(request);

    const rule = faults.find((candidate) => candidate.remaining > 0 && candidate.match(request));
    if (rule) {
      rule.remaining -= 1;
      const fault = rule.fault;
      if (fault.type === "status") {
        res.writeHead(fault.status, { "Content-Type": "text/plain" });
        res.end(fault.body ?? "error");
        return;
      }
      if (fault.type === "raw") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(fault.body);
        return;
      }
      if (fault.type === "stall_body") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write("[");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, fault.ms));
      if (res.destroyed) return;
    }

    if (request.authorization !== `Bearer ${FAKE_HA_TOKEN}`) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("401: Unauthorized");
      return;
    }

    if (request.method === "GET" && path === "/api/states") {
      sendJson(res, 200, [...state.values()]);
      return;
    }
    const stateMatch = /^\/api\/states\/([^/]+)$/.exec(path);
    if (request.method === "GET" && stateMatch) {
      const entity = state.get(decodeURIComponent(stateMatch[1]!));
      if (!entity) sendJson(res, 404, { message: "Entity not found." });
      else sendJson(res, 200, entity);
      return;
    }
    const serviceMatch = /^\/api\/services\/([^/]+)\/([^/]+)$/.exec(path);
    if (request.method === "POST" && serviceMatch) {
      const data = request.body ?? {};
      const entity = state.get(String(data.entity_id));
      if (!entity) {
        sendJson(res, 400, { message: "Unknown entity" });
        return;
      }
      const error = applyService(entity, serviceMatch[1]!, serviceMatch[2]!, data);
      if (error) {
        sendJson(res, 400, { message: `${error} for ${entity.entity_id}` });
        return;
      }
      sendJson(res, 200, [entity]);
      return;
    }
    sendJson(res, 404, { message: "Not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    token: FAKE_HA_TOKEN,
    requests,
    entities: state,
    addFault(match, fault, times = Number.POSITIVE_INFINITY) {
      const matcher =
        typeof match === "string" ? (request: RecordedRequest) => request.path.includes(match) : match;
      faults.push({ match: matcher, fault, remaining: times });
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A URL on which nothing listens (the port was bound, then released). */
export async function unusedLocalUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}
