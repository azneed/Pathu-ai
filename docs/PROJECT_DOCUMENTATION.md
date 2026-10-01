# Pathu — Project Documentation

Personal bedroom AI assistant (modular monolith). Formerly developed under the working name **Andru**; current product identity is **Pathu**.  
Repository: [azneed/Pathu-ai](https://github.com/azneed/Pathu-ai). Development server: `http://127.0.0.1:3001`.

## Architecture

```
Voice / HTTP / Mobile client
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
- The Android app is a thin client over the same `/chat` API (no on-device LLM).

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
| Mobile | `mobile/pathu/` | Expo Android client (text chat → `/chat`) |

## Mobile Android client (Phase 6 · COMPLETE)

Location: `mobile/pathu` (Expo SDK 57 + `expo-dev-client`).

```
Mobile UI
  → src/api (fetch)
  → http://127.0.0.1:3001  (USB: adb reverse tcp:3001)
  → existing POST /chat
```

### Dev command

From `mobile/pathu`:

```bash
npm run dev:android
```

Requires the Pathu backend already listening on **3001**. The helper sets JDK 17, verifies ADB, reverses **8081** (Metro) and **3001** (API), and opens the installed development build.

### Config

```bash
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3001
```

See `mobile/pathu/.env.example`. Do not use a LAN IP for the USB workflow.

### Chat contract (unchanged)

- Request: `{ "message": string }`
- Success: `{ "reply": string, "devices": ..., "toolTrace": ..., ... }`
- Errors: `{ "error": string, "details"?: ... }` with non-2xx status

Mic control opens the foreground voice loop (Phase 7).

## Mobile wake word (Phase 7A · experiment COMPLETE · foreground)

**Status:** COMPLETE as an experiment. The sherpa-onnx pipeline runs end-to-end on-device (the known-good WAV self-test detects `HEY PATHU`), but the current GigaSpeech KWS model does **not** reliably recognize the user's own spoken “Hey Pathu” on the physical iQOO Neo 10R. Offline analysis of a clear stock-recorder capture showed the model decoding the phrase as “HELLO”-like tokens; capture format, cadence and mic ownership were verified correct. This implementation stays as the baseline until it is replaced.

**Next architecture (planned, not implemented):** custom openWakeWord “Hey Pathu” model + native Android voice core.

Engine: **sherpa-onnx** open-vocabulary keyword spotting. Fully local on-device.

- Package: `@siteed/sherpa-onnx.rn`
- Mic PCM: `react-native-live-audio-stream` (16 kHz mono PCM16 → float32)
- Models: English GigSpeech KWS int8 (`assets/wakeword/sherpa-kws-en/`; fetch with `scripts/fetch-kws-models.ps1`)
- Keyword file: `keywords.txt` encodes **HEY PATHU** (BPE; no custom neural training / no Picovoice `.ppn`)
- Phase 7A is **foreground only** (app open / unlocked)

## Mobile foreground voice conversation (Phase 7)

**Status:** COMPLETE — foreground loop wired and verified on physical Android when the app is open.

Flow:

1. Local KWS detects **“Hey Pathu”**
2. KWS stops and releases the microphone
3. `expo-speech-recognition` captures one command (`en-US`; prefers on-device when `supportsOnDeviceRecognition()` is true, else Android system/remote STT)
4. Final transcript → existing mobile `POST /chat`
5. Real `reply` spoken with `expo-speech`
6. KWS restarts for the next wake

- Orchestrator: `mobile/pathu/src/voice/`
- STT/TTS: `mobile/pathu/src/speech/`
- One command per wake (no continuous open-mic conversation)
- Do **not** claim command STT is fully offline unless the device reports on-device recognition
- Locked-screen / background / always-on wake is **Phase 7B**

Native rebuild is required after adding speech modules. Day-to-day: `npm run dev:android`.

## Phase 7B.1 — Android microphone foreground service / locked-screen wake baseline

**Status:** Foreground service implemented; locked-screen wake remains **pending** because the current wake model is unsuitable for the user's voice. On the physical iQOO Neo 10R the microphone FGS keeps a single unsilenced `MIC` recorder and the KWS consuming live audio while the screen is locked; stop/restart/duplicate-start/background transitions are clean. Live-voice “Hey Pathu” was **not** detected in the 2026-09-28 session (neither unlocked nor locked; the WAV self-test still detects), so locked-screen wake detection is **not** yet verified. Details: `docs/CHANGELOG.md`.

- Local module: `mobile/pathu/modules/pathu-wake-fgs` (`PathuWakeForegroundService`, `foregroundServiceType="microphone"`)
- Ongoing notification: “Pathu is listening for Hey Pathu”
- The FGS does **not** capture audio itself; the existing JS LiveAudioStream → sherpa-onnx pipeline stays the only mic consumer
- Lifecycle: `sherpaWakeWord.start()` → FGS start; `sherpaWakeWord.stop()` (incl. STT handoff) → FGS stop
- Background with FGS active: keep the running KWS instance; wake detections are recorded; STT starts only when the app is active
- Android forbids starting a mic FGS from background, so the listener must be started while unlocked/foreground
- Service states: `stopped`, `starting`, `listening`, `stopping`, `error`; JS observes via `wakeForegroundService.subscribe`
- Permissions: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS` (runtime on API 33+), `WAKE_LOCK`
- iQOO/OriginOS battery management may still kill background apps — not claimed reliable until physically verified
- Not included: boot start (Phase 7B.2+)

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

**PorcupineWakeWordDetector** is a legacy, inactive browser stub (always refuses to start; covered by `test/voice.wake.test.ts`). Picovoice is **not** the planned wake engine: the mobile direction is a custom openWakeWord model (see Phase 7A). The stub is kept only to avoid changing the backend voice API in a docs/cleanup pass.

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
