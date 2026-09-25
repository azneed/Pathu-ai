import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { z } from "zod";
import { runChat } from "../ai/chat.js";
import { validateDeviceAction } from "../ai/deviceActions.js";
import type { LLMProvider } from "../ai/provider.js";
import type { Db } from "../db/index.js";
import type { DeviceGateway } from "../devices/types.js";
import { resolveAudiusStreamUrl } from "../music/audius.js";
import { audiusTrackIdSchema } from "../music/clientActions.js";
import { resetMusicSession } from "../music/session.js";
import { DEVICE_ACTION_TOOLS } from "../tasks/types.js";
import { resetYoutubeSession } from "../youtube/session.js";

const chatBodySchema = z.object({
  message: z.string().trim().min(1, "message is required"),
});

const routineActionSchema = z
  .object({
    tool: z.enum(DEVICE_ACTION_TOOLS),
    arguments: z.record(z.unknown()),
  })
  .strict();

const createRoutineBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    actions: z.array(routineActionSchema).min(1).max(20),
  })
  .strict();

const updateRoutineBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    actions: z.array(routineActionSchema).min(1).max(20).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.actions !== undefined,
    "Provide at least one field to update",
  );

const VOICE_HTML_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../public/voice.html",
);

const VOICE_CORE_JS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../public/voice-core.js",
);

export interface AppDeps {
  db: Db;
  gateway: DeviceGateway;
  provider: LLMProvider;
  timeZone?: string;
  youtubeApiKey?: string;
  audiusApiKey?: string;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const timeZone =
    deps.timeZone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone ??
    "UTC";
  const audiusApiKey = deps.audiusApiKey ?? "";

  app.get("/health", (c) => c.json({ ok: true, name: "pathu" }));

  app.get("/voice", (c) => {
    const html = readFileSync(VOICE_HTML_PATH, "utf8");
    return c.html(html);
  });

  app.get("/voice-core.js", (c) => {
    const js = readFileSync(VOICE_CORE_JS_PATH, "utf8");
    return new Response(js, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  });

  app.get("/devices", (c) => {
    return c.json({ devices: deps.gateway.getAll() });
  });

  app.get("/tasks", (c) => {
    const status = c.req.query("status");
    const tasks =
      status === "pending" ||
      status === "running" ||
      status === "completed" ||
      status === "canceled" ||
      status === "failed"
        ? deps.db.tasks.list({ status, limit: 100 })
        : deps.db.tasks.list({ status: ["pending", "running"], limit: 100 });
    return c.json({ timeZone, tasks });
  });

  app.get("/routines", (c) => {
    return c.json({ routines: deps.db.routines.list({ limit: 100 }) });
  });

  app.get("/routines/:id", (c) => {
    const routine = deps.db.routines.get(c.req.param("id"));
    if (!routine) {
      return c.json({ error: "Routine not found" }, 404);
    }
    return c.json({ routine });
  });

  app.post("/routines", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = createRoutineBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        400,
      );
    }
    try {
      for (const action of parsed.data.actions) {
        validateDeviceAction(action.tool, action.arguments);
      }
      const routine = deps.db.routines.create({
        name: parsed.data.name,
        description: parsed.data.description,
        actions: parsed.data.actions,
      });
      return c.json({ ok: true, routine }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "Could not create routine", details: message }, 400);
    }
  });

  app.patch("/routines/:id", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = updateRoutineBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        400,
      );
    }
    try {
      if (parsed.data.actions) {
        for (const action of parsed.data.actions) {
          validateDeviceAction(action.tool, action.arguments);
        }
      }
      const routine = deps.db.routines.update(c.req.param("id"), {
        name: parsed.data.name,
        description: parsed.data.description,
        actions: parsed.data.actions,
      });
      return c.json({ ok: true, routine });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /not found/i.test(message) ? 404 : 400;
      return c.json({ error: "Could not update routine", details: message }, status);
    }
  });

  app.delete("/routines/:id", (c) => {
    try {
      const deleted = deps.db.routines.delete(c.req.param("id"));
      return c.json({ ok: true, deleted });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "Could not delete routine", details: message }, 404);
    }
  });

  app.post("/routines/:id/run", (c) => {
    try {
      const execution = deps.db.routines.execute(
        c.req.param("id"),
        deps.gateway,
      );
      return c.json({
        success: execution.success,
        ok: execution.ok,
        routineId: execution.routineId,
        routineName: execution.routineName,
        completedActions: execution.completedActions,
        failedActionIndex: execution.failedActionIndex,
        failedAt: execution.failedAt,
        error: execution.error,
        routine: execution.routine,
        results: execution.results,
        devices: deps.gateway.getAll(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "Could not run routine", details: message }, 404);
    }
  });

  /**
   * Same-origin stream resolver. Browser never sees AUDIUS_API_KEY.
   * Redirects to the HTTPS CDN URL returned by Audius.
   */
  app.get("/music/stream/:trackId", async (c) => {
    const parsed = audiusTrackIdSchema.safeParse(c.req.param("trackId"));
    if (!parsed.success) {
      return c.json({ error: "Invalid track id" }, 400);
    }
    try {
      const url = await resolveAudiusStreamUrl({
        apiKey: audiusApiKey,
        trackId: parsed.data,
      });
      return c.redirect(url, 302);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("music stream error:", message);
      return c.json({ error: "Stream unavailable", details: message }, 502);
    }
  });

  app.post("/session/reset", (c) => {
    deps.db.clearMessages("default");
    resetYoutubeSession("default");
    resetMusicSession("default");
    return c.json({ ok: true, sessionId: "default" });
  });

  app.post("/chat", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = chatBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid request body",
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    try {
      const result = await runChat({
        message: parsed.data.message,
        provider: deps.provider,
        gateway: deps.gateway,
        db: deps.db,
        timeZone,
        youtubeApiKey: deps.youtubeApiKey ?? "",
        audiusApiKey,
      });
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("chat error:", message);
      return c.json({ error: "Chat failed", details: message }, 500);
    }
  });

  return app;
}
