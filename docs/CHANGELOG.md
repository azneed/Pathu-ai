# Changelog

## Phase 4.5 — Hands-Free Voice / Wake Word

### Added

- `src/voice/` — wake phrase helpers, voice state machine, wake-detector abstraction
- `public/voice-core.js` — browser helpers for `/voice`
- Hands-free + push-to-talk mode toggle on `/voice`
- Explicit states: IDLE → LISTENING → PROCESSING → SPEAKING → IDLE (ERROR recover)
- Transcript-based wake detector (interim) for “Hey Andru” / “Andru”
- Porcupine stub documenting path to fully local custom wake models
- Tests: `test/voice.wake.test.ts`

### Limitations

- True neural on-device “Hey Andru” is **not** claimed: needs Picovoice custom `.ppn` + AccessKey.
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
