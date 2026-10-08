import type { Config } from "../config.js";
import { GeminiProvider } from "./geminiProvider.js";
import { OllamaProvider } from "./ollamaProvider.js";
import { OpenAIProvider } from "./openaiProvider.js";
import { OpenRouterProvider } from "./openRouterProvider.js";
import {
  ProviderError,
  ProviderRouter,
  type NamedLLMProvider,
  type ProviderName,
} from "./router.js";
import type { LLMProvider } from "./types.js";

function createNamedProvider(
  name: ProviderName,
  config: Config,
): NamedLLMProvider {
  switch (name) {
    case "gemini":
      return {
        name,
        provider: new GeminiProvider({
          apiKey: config.GEMINI_API_KEY,
          model: config.GEMINI_MODEL,
        }),
      };
    case "openrouter":
      return {
        name,
        provider: new OpenRouterProvider({
          apiKey: config.OPENROUTER_API_KEY,
          model: config.OPENROUTER_MODEL,
          baseUrl: config.OPENROUTER_BASE_URL,
        }),
      };
    case "ollama":
      return {
        name,
        provider: new OllamaProvider({
          baseUrl: config.OLLAMA_BASE_URL,
          model: config.OLLAMA_MODEL,
          apiKey: config.OLLAMA_API_KEY,
        }),
      };
    case "openai":
      return {
        name,
        provider: new OpenAIProvider(
          config.OPENAI_API_KEY,
          config.OPENAI_MODEL,
        ),
      };
    default: {
      const _exhaustive: never = name;
      throw new ProviderError(`Unknown AI provider: ${_exhaustive}`, {
        recoverable: false,
      });
    }
  }
}

/** Central factory: chat/devices only ever see LLMProvider. */
export function createLLMProvider(config: Config): LLMProvider {
  const primary = createNamedProvider(config.AI_PRIMARY, config);

  const fallback =
    config.AI_FALLBACK && config.AI_FALLBACK !== config.AI_PRIMARY
      ? createNamedProvider(config.AI_FALLBACK, config)
      : undefined;

  return new ProviderRouter(primary, fallback, {
    cooldownSeconds: config.AI_PROVIDER_COOLDOWN_SECONDS,
  });
}
