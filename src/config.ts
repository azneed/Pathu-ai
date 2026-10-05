import { z } from "zod";

const providerNameSchema = z.enum(["gemini", "ollama", "openai", "openrouter"]);

const envSchema = z.object({
  AI_PRIMARY: providerNameSchema.default("gemini"),
  AI_FALLBACK: providerNameSchema.optional().default("openrouter"),

  GEMINI_API_KEY: z
    .string()
    .optional()
    .default("")
    .transform((value) => value.trim()),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),

  OPENROUTER_API_KEY: z
    .string()
    .optional()
    .default("")
    .transform((value) => value.trim()),
  OPENROUTER_MODEL: z.string().default("openrouter/free"),
  OPENROUTER_BASE_URL: z
    .string()
    .default("https://openrouter.ai/api/v1"),

  OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("llama3.2"),

  OPENAI_API_KEY: z
    .string()
    .optional()
    .default("")
    .transform((value) => value.trim()),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),

  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_PATH: z.string().default("./data/andru.db"),

  /** IANA timezone for interpreting clock times in tasks (e.g. Asia/Dubai). */
  ANDRU_TIMEZONE: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = (value ?? "").trim();
      return (
        trimmed ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "UTC"
      );
    }),

  /** YouTube Data API v3 key (server-side only). Empty = search disabled. */
  YOUTUBE_API_KEY: z
    .string()
    .optional()
    .default("")
    .transform((value) => value.trim()),

  /** Audius API key (server-side only). Empty = music search disabled. */
  AUDIUS_API_KEY: z
    .string()
    .optional()
    .default("")
    .transform((value) => value.trim()),

  /**
   * Shared secret clients send as `Authorization: Bearer <secret>`.
   * Empty = auth disabled, which is only allowed on a loopback HOST.
   */
  PATHU_API_SECRET: z
    .string()
    .optional()
    .default("")
    .transform((value) => value.trim()),

  /**
   * Seconds to skip a provider after HTTP 429 / quota / rate-limit errors.
   * Default 300 (5 minutes). In-memory only; clears on success or expiry.
   */
  AI_PROVIDER_COOLDOWN_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(86_400)
    .default(300),

  /** Smart-home backend. Never switches implicitly; "homeassistant" requires URL + token. */
  DEVICE_BACKEND: z.preprocess(
    blankToUndefined,
    z.enum(["simulated", "homeassistant"]).default("simulated"),
  ),

  /** Home Assistant base URL, e.g. http://homeassistant.local:8123 (trailing slash removed). */
  HOME_ASSISTANT_URL: z.preprocess(
    blankToUndefined,
    z
      .string()
      .refine(isPlainHttpUrl, {
        message:
          "must be an http(s) URL without credentials, query or fragment, e.g. http://homeassistant.local:8123",
      })
      .transform((value) => value.replace(/\/+$/, ""))
      .optional(),
  ),

  /** Home Assistant long-lived access token. Never logged. */
  HOME_ASSISTANT_TOKEN: z.preprocess(blankToUndefined, z.string().optional()),

  /** Per-request timeout for Home Assistant calls (whole request + response). */
  HOME_ASSISTANT_TIMEOUT_MS: z.preprocess(
    blankToUndefined,
    z.coerce
      .number()
      .int()
      .positive()
      .max(60_000)
      .default(5000),
  ),
});

function blankToUndefined(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function isPlainHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === ""
  );
}

const configSchema = envSchema.superRefine((config, ctx) => {
  if (config.DEVICE_BACKEND !== "homeassistant") return;
  for (const key of ["HOME_ASSISTANT_URL", "HOME_ASSISTANT_TOKEN"] as const) {
    if (!config[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: "is required when DEVICE_BACKEND=homeassistant",
      });
    }
  }
});

export type Config = z.infer<typeof configSchema>;

/** Pre-release Home Assistant variable names; they are ignored and only produce a warning. */
export const LEGACY_HOME_ASSISTANT_VARS = ["HOMEASSISTANT_BASE_URL", "HOMEASSISTANT_TOKEN"] as const;

export function findLegacyHomeAssistantVars(env: NodeJS.ProcessEnv = process.env): string[] {
  return LEGACY_HOME_ASSISTANT_VARS.filter((key) => (env[key] ?? "").trim() !== "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${details}`);
  }
  return result.data;
}
