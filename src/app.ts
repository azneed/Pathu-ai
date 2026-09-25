import { serve } from "@hono/node-server";
import { createLLMProvider } from "./ai/createLLMProvider.js";
import { loadConfig, type Config } from "./config.js";
import { openDb } from "./db/index.js";
import { Gateway } from "./devices/gateway.js";
import { createRegistry } from "./devices/registry.js";
import { SimulatedAdapter } from "./devices/simulated.js";
import { createApp } from "./api/routes.js";
import { TaskScheduler } from "./tasks/scheduler.js";

export function createRuntime(config: Config = loadConfig()) {
  let scheduler: TaskScheduler | undefined;

  const db = openDb(config.DATABASE_PATH, {
    timeZone: config.ANDRU_TIMEZONE,
    onTasksChanged: () => scheduler?.notify(),
  });
  const adapter = new SimulatedAdapter(db);
  const registry = createRegistry(adapter);
  const gateway = new Gateway(registry);
  const provider = createLLMProvider(config);

  scheduler = new TaskScheduler({
    tasks: db.tasks,
    gateway,
  });

  const app = createApp({
    db,
    gateway,
    provider,
    timeZone: config.ANDRU_TIMEZONE,
    youtubeApiKey: config.YOUTUBE_API_KEY,
    audiusApiKey: config.AUDIUS_API_KEY,
  });

  return { app, db, gateway, provider, config, scheduler };
}

export function startServer() {
  const { app, config, scheduler, db } = createRuntime();
  scheduler.start();

  const server = serve(
    {
      fetch: app.fetch,
      hostname: config.HOST,
      port: config.PORT,
    },
    (info) => {
      console.log(`Pathu listening on http://${config.HOST}:${info.port}`);
      console.log(
        `AI providers: primary=${config.AI_PRIMARY}, fallback=${config.AI_FALLBACK ?? "none"}`,
      );
      console.log(`Timezone: ${config.ANDRU_TIMEZONE}`);
      console.log(
        `YouTube API: ${config.YOUTUBE_API_KEY ? "configured" : "not configured"}`,
      );
      console.log(
        `Audius API: ${config.AUDIUS_API_KEY ? "configured" : "not configured"}`,
      );
      if (config.AI_PRIMARY === "gemini" && !config.GEMINI_API_KEY) {
        console.warn(
          "GEMINI_API_KEY is missing: primary Gemini calls will fail (fallback may still work).",
        );
      }
      if (config.AI_PRIMARY === "openai" && !config.OPENAI_API_KEY) {
        console.warn(
          "OPENAI_API_KEY is missing: primary OpenAI calls will fail (fallback may still work).",
        );
      }
    },
  );

  const shutdown = () => {
    console.log("Shutting down Pathu…");
    scheduler.stop();
    db.close();
    if (server && typeof (server as { close?: () => void }).close === "function") {
      (server as { close: () => void }).close();
    }
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return { server, scheduler, db };
}
