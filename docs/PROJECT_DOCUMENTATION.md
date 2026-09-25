# Pathu — Project Documentation

Personal bedroom AI assistant (modular monolith). Formerly developed under the working name **Andru**; current product identity is **Pathu**.  
Repository: [azneed/Pathu-ai](https://github.com/azneed/Pathu-ai). Development server: `http://127.0.0.1:3001`.

## Architecture

```
Voice / HTTP client
    → POST /chat
    → LLM provider (Gemini primary, OpenRouter fallback)
    → validated tools
    → DeviceGateway / TaskService / RoutineService / media helpers
    → simulated device adapters + SQLite
```

**Principles**

- Pathu owns intent (LLM + tools).
- Device adapters own actuation.
- Device control always goes through `DeviceGateway` via `executeDeviceAction` / validated `set_*` tools.
- No shell, OS automation, arbitrary URLs, or generic browser control.
- YouTube and Audius are separate restricted media surfaces on `/voice`.

## Modules

| Area | Path | Role |
|------|------|------|
| Chat / tools | `src/ai/` | Prompt, tool registry, providers, device-action Zod helpers |
| API | `src/api/routes.ts` | Hono routes |
| DB | `src/db/` | SQLite schema + `openDb` |
| Devices | `src/devices/` | Gateway, registry, simulated adapters |
| Tasks | `src/tasks/` | Delayed / scheduled / recurring device actions + `TaskScheduler` |
| Routines | `src/routines/` | Persistent named scenes of device actions |
| YouTube | `src/youtube/` | Search + typed `clientActions` for `/voice` IFrame |
| Audius | `src/music/` | Search + stream path + typed music `clientActions` |
| Voice UI | `public/voice.html` | STT/TTS + YouTube/Audius players |
| Wake helpers | `src/voice/` + `public/voice-core.js` | Phrases, state machine, wake detector abstraction |

## Routines / scenes (Phase 4)

Persistent named sequences of **home device** actions only.

### Data model

SQLite table `routines`:

- `id`, `name`, `description`, `actions_json`, `created_at`, `updated_at`
- Index on `lower(name)` for case-insensitive lookup

Each action is the shared task shape:

`{ tool: "set_ac" | "set_fan" | "set_lights" | "set_rgb", arguments: { ... } }`

Validated with the same helpers as tasks (`validateDeviceAction` / `executeDeviceAction`).

### Tools

`list_routines`, `run_routine`, `create_routine`, `update_routine`, `delete_routine`

### Execution

Sequential through DeviceGateway; **stops on first failure**. Results expose success, completed actions, and failed action index when applicable.

### REST

`GET/POST /routines`, `GET/PATCH/DELETE /routines/:id`, `POST /routines/:id/run`

## Media

- **YouTube** — video IFrame on `/voice`; Data API key server-side.
- **Audius** — HTMLAudioElement; `AUDIUS_API_KEY` server-side; `/music/stream/:trackId` resolves CDN URLs.

## Voice / wake word (Phase 4.5 + Phase 5)

`/voice` supports **Hands-free** and **Push-to-talk**.

### Architecture

```
WakeWordDetector (browser)
  → Voice state machine (IDLE / LISTENING / PROCESSING / SPEAKING / ERROR)
  → existing POST /chat
  → existing tools / DeviceGateway / media clientActions
  → existing speechSynthesis TTS
  → back to IDLE (wake armed again)
```

### Wake-word engine (current)

**TranscriptWakeWordDetector** (interim): continuous Web Speech API transcripts matched against configurable phrases (`hey pathu`, `pathu`).

- Does **not** call Gemini/OpenRouter/Pathu LLM providers for wake detection.
- On Chromium, Web Speech may send microphone audio to the **browser vendor** for STT (not to Pathu LLM providers).
- This is **not** a neural on-device wake model.

**PorcupineWakeWordDetector** stub is reserved for a future fully local WASM engine. It requires a Picovoice AccessKey and a custom `Hey Pathu` Web WASM `.ppn` model from Picovoice Console — not bundled yet.

### Supported phrases

- `Hey Pathu` (primary)
- `Pathu` (optional)

Legacy `Hey Andru` / `Andru` phrases are **not** active in the default configuration after Phase 5.

Single utterance: `Hey Pathu, turn the AC to 23.` → command extracted → `/chat`.

Two-stage: `Hey Pathu` → LISTENING → command → `/chat`.

Push-to-talk remains available as a fallback/manual mode.

### Privacy

Wake matching must not stream raw mic audio to Pathu LLM providers. Only the extracted command text is sent to `/chat`.

### LLM provider cooldown

`AI_PROVIDER_COOLDOWN_SECONDS` (default `300`) controls how long Pathu skips a provider after **HTTP 429 / quota / rate-limit / resource exhausted** errors.

Behavior (in-memory only; no DB):

1. Provider hits a cooldown-trigger error → marked unavailable for N seconds.
2. While cooling down, that provider is not called; the configured fallback is tried immediately.
3. If **all** configured providers are in cooldown → fail fast with a clear error (no upstream calls).
4. After expiry (or a successful call) → provider is eligible again without restart.

Timeouts / 5xx still fall back as before but do **not** enter cooldown.

`AI_PRIMARY` / `AI_FALLBACK` (e.g. `gemini` → `openrouter`) are unchanged. Ollama remains selectable.

### Compatibility names

Some technical identifiers retain the historical Andru prefix for stability, including:

- `ANDRU_TIMEZONE`
- default `DATABASE_PATH=./data/andru.db`
- browser `localStorage` keys `andru_tts_voice` / `andru_voice_mode`

## Graphify

Use the installed CLI (no obsolete flags):

```bash
graphify update .
```
