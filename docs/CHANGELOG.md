# Changelog

## Tooling — npm → pnpm workspace (2026-10-01)

No application behavior or dependency versions changed.

- Package manager pinned: `"packageManager": "pnpm@11.13.0"` (root `package.json`)
- New `pnpm-workspace.yaml`: root backend + `mobile/pathu`; `nodeLinker: hoisted`, `hoistingLimits: workspaces` (same per-package `node_modules` layout as the previous npm installs, so Metro, Gradle `require.resolve` and `patch-package` resolve unchanged); `allowBuilds` permits only `esbuild` and `@siteed/sherpa-onnx.rn`
- Single root `pnpm-lock.yaml` imported from the two npm lockfiles (`pnpm import`); `package-lock.json` and `mobile/pathu/package-lock.json` removed
- npm-only `allowScripts` fields removed from both `package.json` files (replaced by `allowBuilds`)
- `scripts/dev-android.ps1` starts Metro with `pnpm exec expo start` (JDK 17, ADB, reverse 8081/3001 unchanged)
- Commands: `pnpm install`, `pnpm start`, `pnpm test`, `pnpm run typecheck`, `pnpm run dev:android`, `pnpm expo install <package>`

## Cleanup — pre-openWakeWord audit (2026-09-28)

No production wake-word behavior changed. sherpa-onnx remains the baseline until replaced.

### Status after investigation

- **Phase 6** Android text chat — COMPLETE
- **Phase 7A** sherpa-onnx foreground wake — COMPLETE as an experiment; the current GigaSpeech KWS model does not reliably recognize the user's own “Hey Pathu” (clear stock-recorder capture decodes as “HELLO”-like tokens; keyword variants and the zh-en phone model did not help; capture pipeline verified correct)
- **Phase 7** foreground conversation — COMPLETE
- **Phase 7B.1** microphone foreground service implemented; locked-screen wake pending because the current wake model is unsuitable for the user's voice
- **Next (planned, not implemented):** custom openWakeWord “Hey Pathu” model + native Android voice core

### Removed (mobile)

- Unused Expo starter template: `src/app/explore.tsx`, `src/components/*`, `src/hooks/*`, `src/constants/theme.ts`, `src/global.css`, `scripts/reset-project.js` (+ `reset-project` npm script), template images
- Unused dependencies: `expo-device`, `expo-image`, `expo-web-browser`
- One-off DEV experiments: AudioRecord rate A/B and mic source A/B sweeps
- Gradle build artifacts accidentally captured in `patches/react-native-live-audio-stream+1.1.1.patch` (patch now contains only the Java source fix)

### Kept

- DEV diagnostics: WAV self-test, 5 s mic diagnostic (16 kHz mono MIC + offline KWS), STT-only test, resume voice controller
- `react-native-live-audio-stream` + patch (migration candidate for the native voice core)

## Phase 7B.1 — Android microphone foreground service / locked-screen wake baseline

**Status:** Service/mic baseline **verified** on physical iQOO Neo 10R (vivo I2221, Android SDK 36). Locked-screen **“Hey Pathu” detection NOT verified** — live-voice KWS did not fire in this session, unlocked or locked. Phase 7B.1 remains **pending**.

### Physical verification (2026-09-28, iQOO Neo 10R)

| Check | Result |
|--------|--------|
| APK install / launch / foreground chat | Pass (`hello` → “Hello! How can I assist you?”) |
| FGS start with wake listening | Pass — `isForeground=true`, `types=0x80` (microphone), notification id 7101 |
| Notification text | Pass — “Pathu is listening for Hey Pathu” |
| Screen locked (power button, 20 s – 2 min) | Pass — FGS stays foreground, single `MIC` recorder `active=true silenced=false`, KWS keeps consuming live frames, JS receives live mic levels while locked |
| Screen events | `screen_off` / `screen_on` logged by the service |
| Stop wake | Pass — service destroyed, notification removed, recorder `active=false` |
| Restart / triple-tap Start | Pass — one service, one active recorder, `duplicate start ignored (already listening)` |
| Background ↔ foreground ×3 | Pass — one service, one active recorder each time |
| On-device WAV self-test | Pass — native `keyword: "HEY PATHU"` |
| Live voice “Hey Pathu”, unlocked | **Fail** — 9 utterances, peak levels 0.2–0.6, no KWS hit (same result with FGS disabled in an A/B run → not caused by the FGS) |
| Live voice “Hey Pathu”, locked | **Not detected** — live audio reached KWS while locked, but no hit |
| PC-speaker TTS clips (7 variants) | No hit (acoustic playback not a reliable proxy) |

### Added

- Local Expo module `mobile/pathu/modules/pathu-wake-fgs` (Android only)
  - `PathuWakeForegroundService` — `foregroundServiceType="microphone"`, ongoing notification “Pathu is listening for Hey Pathu”, partial wake lock, screen off/on/unlock receiver
  - JS bridge `wakeForegroundService` (`start` / `stop` / `getState` / state events)
  - Service state: `stopped` · `starting` · `listening` · `stopping` · `error`
- Permissions: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS`, `WAKE_LOCK`
- KWS start also starts the FGS; KWS stop (incl. STT handoff) stops it
- Background: when FGS is active, voice controller keeps the existing KWS instance (no restart, no duplicate listener); wake while locked is recorded but does not start STT
- Voice panel diagnostics: FGS state, screen event, last wake, OEM/SDK
- `sherpaWakeWord.start()` / `stop()` serialized; `start()` while already listening is a no-op (removed startup double-restart)
- DEV-only once-per-second mic peak log (`[PathuWake] level peak=…`, only when ≥ 0.15; no audio data)

### Observed limitations

- React Native JS timers pause while the activity is stopped (locked/background); the 1.5 s background branch does not run, KWS simply keeps running under the FGS and the app-state guard keeps wakes from starting STT
- `react-native-live-audio-stream` never calls `AudioRecord.release()`; a stopped recorder lingers as an inactive client until GC (does not capture or hold the mic)
- vivo/OriginOS throttles logcat for the app process at times; Metro JS logs remain reliable
- Longer locked durations / battery-saver / OriginOS background freezing not yet tested

### Unchanged

- sherpa-onnx model, keywords, thresholds, 16 kHz mono PCM16 / 1600-sample frames, `AudioSource.MIC`, LiveAudioStream patch
- Foreground wake → STT → `/chat` → TTS loop
- No boot start

## Phase 7 — Foreground voice conversation

**Status:** Verified on physical iQOO Neo 10R (foreground).

### Added

- Full foreground voice loop after local **“Hey Pathu”** (sherpa-onnx KWS unchanged)
- Command speech recognition via **`expo-speech-recognition@57.1.0`** (prefer on-device when available; otherwise Android system/remote STT; empty on-device result retries system)
- Reply speech via **`expo-speech@57.0.3`** (not `expo-av`)
- Orchestrator: `mobile/pathu/src/voice/VoiceConversationController.ts`
- STT/TTS services: `mobile/pathu/src/speech/`
- Exclusive mic handoff: stop KWS → STT → `/chat` → TTS → restart KWS
- One command per wake; return to wake listening after TTS
- Voice status UI + Diagnostics (existing wake panel)
- On iQOO Neo 10R: `supportsOnDeviceRecognition()` is true (STT mode shown as on-device)

### Explicitly not claimed

- Locked-screen / background / always-on wake remains **Phase 7B**
- Command STT is still subject to Android availability (on-device preferred, system fallback)

### Unchanged

- Backend `/chat` contract
- Local KWS engine (sherpa-onnx)
- Text composer still works

## Phase 7A — Local Android wake word (sherpa-onnx) · COMPLETE (experiment)

**Status:** COMPLETE as an experiment. Later physical testing (see Phase 7B.1 and the cleanup entry) showed the current model does not reliably recognize the user's own voice/phrase; the original live-mic result below did not hold up.

### Result

- Local **sherpa-onnx** open-vocabulary KWS on Android
- Live microphone detects **“Hey Pathu”** successfully
- Physical Android verification: iQOO Neo 10R (USB + `npm run dev:android`)
- Foreground-only (app open / unlocked) — not background or lock-screen

### Added

- Foreground local wake-word detection via **sherpa-onnx** KWS (English GigSpeech int8)
- Keyword: **Hey Pathu** (`keywords.txt` BPE encoding; no custom Picovoice `.ppn`)
- Packages: `@siteed/sherpa-onnx.rn`, `react-native-live-audio-stream`, `expo-file-system`, `expo-asset`
- Wake service `mobile/pathu/src/wakeword/` + Phase 7A test panel (diagnostics + WAV self-test)
- `scripts/fetch-kws-models.ps1` to download models + regenerate keywords
- `RECORD_AUDIO` via Expo / Android permissions
- Patch for `react-native-live-audio-stream` (encode only `bytesRead`; New Arch event stubs)

### Explicitly not used

- Picovoice / Porcupine (Console company-email requirement)
- Transcript / Web Speech wake matching on mobile
- Cloud wake detection

### Unchanged / deferred (Phase 7B+)

- Backend `/chat` untouched by wake detection
- No auto `/chat` on wake yet
- Background / locked-screen / always-on wake is **Phase 7B**

## Phase 6 — Pathu Android text chat client

### Added

- Expo mobile app chat UI (`mobile/pathu`) talking to the existing Pathu backend
- Typed mobile API client (`GET /health`, `POST /chat`)
- `EXPO_PUBLIC_API_BASE_URL` (USB default `http://127.0.0.1:3001`)
- `npm run dev:android` already reverses Metro **8081** and API **3001**

### Unchanged

- Backend AI / tools / devices / routines / tasks
- No second mobile LLM
- No native rebuild required for this phase (JS-only)
- Voice/wake on mobile deferred

## Phase 5 — Pathu Rebrand

### Changed

- User-facing assistant name: **Pathu** (was Andru)
- Default wake phrases: `hey pathu` / `pathu` (legacy `hey andru` / `andru` no longer match by default)
- `/voice` branding, status labels, and TTS intro copy
- System prompt identity (`You are Pathu…`)
- `/health` name: `pathu`
- README / project docs; GitHub reference `azneed/Pathu-ai`
- Development port docs: `127.0.0.1:3001`
- Package metadata name: `pathu` (private package)

### Unchanged

- Architecture, tools, devices, routines, tasks, media, providers
- Compatibility env/DB names (`ANDRU_TIMEZONE`, `./data/andru.db`)
- Wake-word abstraction and voice state machine behavior
- Push-to-talk fallback

## Phase 4.5 — Hands-Free Voice / Wake Word

### Added

- `src/voice/` — wake phrase helpers, voice state machine, wake-detector abstraction
- `public/voice-core.js` — browser helpers for `/voice`
- Hands-free + push-to-talk mode toggle on `/voice`
- Explicit states: IDLE → LISTENING → PROCESSING → SPEAKING → IDLE (ERROR recover)
- Transcript-based wake detector (interim); phrases later updated to Pathu in Phase 5
- Porcupine stub documenting path to fully local custom wake models
- Tests: `test/voice.wake.test.ts`

### Limitations

- True neural on-device wake is **not** claimed: needs Picovoice custom `.ppn` + AccessKey.
- Chromium Web Speech may send audio to the browser vendor during wake listening.

## LLM Provider Cooldown + Fail-Fast

### Added

- In-memory provider cooldown registry (`src/ai/providerCooldown.ts`)
- `AI_PROVIDER_COOLDOWN_SECONDS` (default 300) in config / `.env.example`
- `ProviderRouter` skips cooling-down providers and fails fast when all are unavailable
- Concise `[AI] …` logs for skip / cooldown / fallback (no API keys)
- Tests: `test/ai.providerCooldown.test.ts`

### Cooldown trigger categories

- HTTP 429
- quota exhausted
- rate limit
- resource exhausted

Non-rate-limit recoverable errors (timeouts, 5xx) still fall back without cooldown.

### Unchanged

- Provider abstraction, Gemini/OpenRouter/Ollama factories
- Device, task, routine, YouTube, Audius behavior

## Phase 4 — Routines & Scenes

### Added

- `src/routines/` — types, SQLite store, service, AI tools
- SQLite `routines` table (`actions_json` of validated `{ tool, arguments }` device actions matching tasks)
- Tools: `list_routines`, `run_routine`, `create_routine`, `update_routine`, `delete_routine`
- REST: `GET/POST /routines`, `GET/PATCH/DELETE /routines/:id`, `POST /routines/:id/run`
- Structured run result: `success` / `ok`, `completedActions`, `failedActionIndex`, `routineId`, `routineName`
- Prompt guidance for create/list/run/update/delete and truthful failure
- Tests: `test/routines.test.ts`, `test/routines.chat.test.ts`

### Behavior

- Routines are persistent named home-device scenes only (AC / fan / lights / RGB).
- Execution is sequential via `executeDeviceAction` → DeviceGateway and **stops on the first failure**.
- Creating/updating a routine does not change devices until `run_routine` succeeds.
- Ambiguous names are rejected (no destructive guessing).
- No built-in hardcoded routines; no routine scheduling in this phase.

### Unchanged

- TaskScheduler, DeviceGateway, LLM providers, YouTube, Audius architectures

## Prior phases (summary)

- **0–1.5** — Chat tools, DeviceGateway, simulated devices, context
- **2 / 2.1** — `/voice` STT/TTS
- **3** — Tasks + TaskScheduler
- **3.5** — Restricted YouTube on `/voice`
- **3.6** — Audius music on `/voice`
