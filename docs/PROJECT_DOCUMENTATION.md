# Andru — Project Documentation

Personal bedroom AI assistant (modular monolith).

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

- Andru owns intent (LLM + tools).
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

## Routines / scenes (Phase 4)

Persistent named sequences of **home device** actions only.

### Data model

SQLite table `routines`:

- `id`, `name`, `description`, `actions_json`, `created_at`, `updated_at`
- Index on `lower(name)` for case-insensitive lookup

Each action is the shared task shape:

```json
{ "tool": "set_ac", "arguments": { "power": "on", "temperature": 24 } }
```

Allowed tools: `set_ac`, `set_fan`, `set_lights`, `set_rgb` — validated by `validateDeviceAction` before persist and re-validated on execute via `executeDeviceAction`.

Not allowed in routines: shell, HTTP, YouTube, Audius, arbitrary JS/URLs.

### Service

`RoutineService` (`src/routines/service.ts`):

- `create` / `get` / `list` / `findByName` / `update` / `delete`
- `execute(id, gateway)` — sequential; **stops on first failure**; returns truthful result:

```json
{
  "success": true,
  "ok": true,
  "routineId": "...",
  "routineName": "Bedtime",
  "completedActions": 4,
  "results": []
}
```

On failure: `success: false`, `completedActions` = successes before stop, `failedActionIndex` (0-based), `error`.

### Tools

- `list_routines`
- `run_routine` (id or unambiguous name)
- `create_routine`
- `update_routine`
- `delete_routine`

Create/update persist only; devices change only after a successful `run_routine`.

### Routines vs tasks

| | Routines | Tasks |
|--|----------|-------|
| Purpose | Reusable immediate scenes | Future / recurring execution |
| When devices change | On `run_routine` | At due time via `TaskScheduler` |
| Failure | Stop on first failed action | Task execute records all action outcomes |
| Scheduling | Not in Phase 4 | Delayed / scheduled / recurring |

A future task may eventually reference a routine id; that is not implemented yet.

### REST

- `GET /routines`
- `GET /routines/:id`
- `POST /routines`
- `PATCH /routines/:id`
- `DELETE /routines/:id`
- `POST /routines/:id/run`

Primary UX remains conversational `/chat` and `/voice`.

## Tasks

See `src/tasks/`. Scheduler runs in-process; due tasks execute through DeviceGateway without calling the LLM again.

## Media

- **YouTube** — video IFrame on `/voice`; Data API key server-side.
- **Audius** — HTMLAudioElement; `AUDIUS_API_KEY` server-side; `/music/stream/:trackId` resolves CDN URLs.

## Voice / wake word (Phase 4.5)

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

**TranscriptWakeWordDetector** (interim): continuous Web Speech API transcripts matched against configurable phrases (`hey andru`, `andru`).

- Does **not** call Gemini/OpenRouter/Andru for wake detection.
- On Chromium, Web Speech may send microphone audio to the **browser vendor** for STT (not to Andru LLM providers).
- This is **not** a neural on-device wake model.

**PorcupineWakeWordDetector** stub is reserved for a future fully local WASM engine. It requires a Picovoice AccessKey and a custom `Hey Andru` Web WASM `.ppn` model from Picovoice Console — not bundled in this phase.

### Supported phrases

- `Hey Andru` (primary)
- `Andru` (optional)

Single utterance: `Hey Andru, turn the AC to 23.` → command extracted → `/chat`.

Two-stage: `Hey Andru` → LISTENING → command → `/chat`.

### Privacy

Wake matching must not stream raw mic audio to Andru LLM providers. Only the extracted command text is sent to `/chat`.

### LLM provider cooldown

`AI_PROVIDER_COOLDOWN_SECONDS` (default `300`) controls how long Andru skips a provider after **HTTP 429 / quota / rate-limit / resource exhausted** errors.

Behavior (in-memory only; no DB):

1. Provider hits a cooldown-trigger error → marked unavailable for N seconds.
2. While cooling down, that provider is not called; the configured fallback is tried immediately.
3. If **all** configured providers are in cooldown → fail fast with a clear error (no upstream calls).
4. After expiry (or a successful call) → provider is eligible again without restart.

Timeouts / 5xx still fall back as before but do **not** enter cooldown.

`AI_PRIMARY` / `AI_FALLBACK` (e.g. `gemini` → `openrouter`) are unchanged. Ollama remains selectable.
