# Pathu

Personal AI assistant (formerly developed as Andru).  
GitHub: [azneed/Pathu-ai](https://github.com/azneed/Pathu-ai)

`POST /chat` → LLM provider (Gemini primary, OpenRouter fallback) → tool calling → DeviceGateway → simulated bedroom devices → persisted state.

Phases:

- **0 / 0.5** — chat → tools → gateway → simulated devices; Gemini + failover providers
- **1 / 1.5** — multi-turn history + device-state context; natural command coverage
- **2 / 2.1** — browser voice UI at `/voice` (STT/TTS) with male voice preference
- **3** — delayed / scheduled / recurring tasks via `create_task` / `cancel_task` / `get_tasks` and an in-process scheduler
- **3.5** — restricted YouTube control (Data API search + embedded IFrame player on `/voice` only)
- **3.6** — Audius music (search + HTMLAudioElement playback on `/voice`; separate from YouTube)
- **4** — persistent Routines/Scenes (named sequences of validated device actions)
- **4.5** — hands-free wake word + push-to-talk on `/voice`
- **5** — Pathu rebrand (assistant name + wake phrases)
- **6** — Android Expo text chat client (`mobile/pathu` → `/chat`) · **COMPLETE**
- **7A** — Local foreground wake-word experiment with sherpa-onnx KWS · **COMPLETE as an experiment**; the current GigaSpeech KWS model does not reliably recognize the user's own “Hey Pathu” (known-good WAV self-test passes)
- **7** — Foreground voice conversation: wake → `expo-speech-recognition` → `POST /chat` → `expo-speech` TTS → wake again (one command per wake; STT may be on-device or system/remote) · **COMPLETE**
- **7B.1** — Android microphone foreground service implemented; locked-screen wake remains **pending** because the current wake model is unsuitable for the user's voice
- **Next (planned, not implemented)** — custom openWakeWord “Hey Pathu” model + native Android voice core

## Setup

```bash
cp .env.example .env
# set GEMINI_API_KEY (primary) and optionally OPENROUTER_API_KEY (fallback)
# set YOUTUBE_API_KEY for YouTube search (server-side only)
# set AUDIUS_API_KEY for Audius music search/stream (server-side only)
pnpm install
```

Requires Node.js 22+ (uses built-in `node:sqlite`).

### Package manager (pnpm workspace)

The repo uses **pnpm**, pinned via `"packageManager": "pnpm@11.13.0"` in the root `package.json` (install once with `npm i -g pnpm@11.13.0`).

- `pnpm-workspace.yaml` — workspace = repo root (backend) + `mobile/pathu`
- `pnpm-lock.yaml` — single lockfile at the repo root (no `package-lock.json`)
- `nodeLinker: hoisted` + `hoistingLimits: workspaces` — flat, symlink-free `node_modules` per package (root deps in `./node_modules`, mobile deps in `mobile/pathu/node_modules`), as React Native / Expo / Gradle expect
- `allowBuilds` — only `esbuild` and `@siteed/sherpa-onnx.rn` (prebuilt native binaries) may run install scripts

One `pnpm install` at the repo root installs both packages and applies the mobile `patch-package` patch.

AI routing: `AI_PRIMARY` / `AI_FALLBACK` (default: `gemini` → `openrouter` with `openrouter/free`). Ollama remains selectable but is not required.

Provider cooldown: `AI_PROVIDER_COOLDOWN_SECONDS` (default `300`). After a 429/quota/rate-limit error, that provider is skipped for N seconds and Pathu falls back immediately; if all providers are cooling down, `/chat` fails fast.

Timezone for clock-based schedules: `ANDRU_TIMEZONE` (IANA name, defaults to the OS timezone; name retained for compatibility).

## Run

```bash
pnpm start
```

Binds to `127.0.0.1:3001` by default.

Open the voice UI:

http://127.0.0.1:3001/voice

Use a Chromium-based browser for best Web Speech API support.

**Voice modes:** Hands-free (`Hey Pathu` / `Hey Pathu, …`) or Push-to-talk (hold mic). Typed input remains available. Wake matching is an interim transcript-based detector — see docs for privacy/limitations.

**Manual hands-free Chrome E2E:** verified working (wake → listen → `/chat` → TTS → idle).

## YouTube (restricted)

Pathu can search and control **only** the YouTube player embedded in `/voice`.

- Server uses YouTube Data API v3 with `YOUTUBE_API_KEY` (never sent to the browser).
- Tools: `youtube_search`, `youtube_play`, `youtube_pause`, `youtube_resume`, `youtube_stop`, `youtube_next`, `youtube_previous`, `youtube_set_volume`.
- `/chat` may return `clientActions` with typed `{ type: "youtube", action: ... }` payloads only.
- The voice page applies those actions via the official YouTube IFrame Player API.

**Security boundary:** no shell, PowerShell, filesystem, keyboard/mouse, Windows app control, or arbitrary browser/URL navigation. Unsupported requests are refused.

**Chrome autoplay:** browsers may block unmuted autoplay. The voice UI confirms real player state before treating a track as playing; if blocked, it shows **Audio blocked — enable audio** and **Enable YouTube audio** instead of claiming success. Audio follows the OS/browser output device (e.g. a Bluetooth speaker if that is the active output).

Examples: "Play the Interstellar trailer.", "Pause.", "Set YouTube volume to 30."

## Audius music (restricted)

Pathu can search and play **music** via Audius on the `/voice` page audio element (separate from YouTube video).

- Server uses the Audius API with `AUDIUS_API_KEY` (never sent to the browser).
- Tools: `music_search`, `music_play`, `music_pause`, `music_resume`, `music_stop`, `music_next`, `music_previous`, `music_set_volume`.
- Flow: `music_search` → `trackId` → `music_play(trackId)`. The LLM never supplies arbitrary stream URLs.
- `/chat` may return `clientActions` with typed `{ type: "music", action: ... }` payloads (play includes a same-origin `streamPath` such as `/music/stream/{trackId}`).
- `GET /music/stream/:trackId` resolves the CDN URL server-side (API key stays on the server) and redirects the browser audio element.

**Separation:** YouTube = video / visual content. Audius = music / audio. Do not use YouTube extraction for music.

**Chrome autoplay:** same rules as YouTube — if blocked, use **Enable music audio**. Output follows the OS/browser device (e.g. Xiaomi Bluetooth speaker when that is the active Windows output). Pathu does not manage Bluetooth pairing.

Examples: "Play some music.", "Play Tum Hi Ho.", "Search Audius for relaxing music.", "Pause.", "Set music volume to 30."

Music scheduling ("play in 10 minutes") is not included in this version.

## Routines / scenes

Named, persistent groups of **home device** actions (AC / fan / lights / RGB only).

- Tools: `list_routines`, `run_routine`, `create_routine`, `update_routine`, `delete_routine`.
- Actions reuse the same validated `{ tool, arguments }` shape as tasks (`set_ac` / `set_fan` / `set_lights` / `set_rgb`).
- Creating/updating a routine saves it; devices change only when `run_routine` succeeds.
- Execution is sequential and **stops on the first failure** (truthful partial results).
- REST: `GET/POST /routines`, `GET/PATCH/DELETE /routines/:id`, `POST /routines/:id/run`.

**Routines vs tasks:** routines = reusable immediate scenes; tasks = delayed/scheduled/recurring future device actions. Routine scheduling is not in this version.

Examples: "Create a bedtime routine…", "Run bedtime.", "What routines do I have?", "Delete movie mode."

## Tasks & scheduling

Pathu can schedule future **device** actions. The LLM interprets natural language; Pathu stores structured actions in SQLite and executes them locally through DeviceGateway — **without** calling Gemini again at due time.

YouTube/music scheduling is not included in this version.

## Endpoints

### `GET /voice`

Browser voice interface (static HTML) including the embedded YouTube player and Audius audio player.

### `GET /music/stream/:trackId`

Same-origin stream resolver for Audius tracks (server uses `AUDIUS_API_KEY`; browser never sees the key).

### `GET /tasks`

List pending/running tasks (optional `?status=`).

### `GET /routines`

List saved routines/scenes.

### `POST /routines` / `PATCH|DELETE /routines/:id` / `POST /routines/:id/run`

Create, update, delete, or immediately run a routine through DeviceGateway.

### `POST /session/reset`

Clears the default conversation history plus YouTube and Audius session search/playlist hints (does not cancel device tasks).

### `GET /devices`

```bash
curl http://127.0.0.1:3001/devices
```

### `POST /chat`

```bash
curl -X POST http://127.0.0.1:3001/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"message\":\"Turn the AC on and set it to 23 degrees.\"}"
```

### `GET /health`

```json
{ "ok": true, "name": "pathu" }
```

## Tests

```bash
pnpm test
pnpm run typecheck
```

## Graphify

Refresh the code graph (no LLM required):

```bash
graphify update .
```
