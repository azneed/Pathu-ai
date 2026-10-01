# Graph Report - andru  (2026-09-28)

## Corpus Check
- 111 files · ~90,727 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 3, .example 2, .model 1)

## Summary
- 1021 nodes · 2327 edges · 59 communities (44 shown, 15 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 32 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b4dbcd66`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ai/tools.ts
- db/index.ts
- geminiProvider.ts
- voice.wake.test.ts
- youtube/tools.ts
- expo
- package.json
- routines/service.ts
- router.ts
- Endpoints
- LLMProvider
- Changelog
- ai/types.ts
- compilerOptions
- PathuWakeForegroundService
- voice-core.js
- Pathu — Project Documentation
- ref_vitest_config
- SherpaWakeWordService
- routes.ts
- dependencies
- src_ai_provider_llmprovider
- pathu/package.json
- SpeechRecognitionServiceImpl
- WakeForegroundServiceController
- VoiceConversationController.ts
- tasks/service.ts
- DeviceGateway
- index.tsx
- VoiceConversationControllerImpl
- pathu-wake-fgs/package.json
- ref_fs
- time.ts
- devDependencies
- mobile_pathu_src_components_animated_icon_module
- pathu/tsconfig.json
- SherpaWakeWord.ts
- USB Android development
- AGENTS.md
- openRouterProvider.ts
- metro.config.js
- react-native-live-audio-stream.d.ts
- wakeword/README.md
- _layout.tsx
- scripts
- createLLMProvider.ts
- ProviderError
- RoutineService
- micOwnership.ts
- allowScripts
- mobile_pathu_src_global
- mobile_pathu_src_hooks_use_color_scheme_usecolorscheme
- ref_expo_package_json
- ref_expo_router_ui
- ref_expo_router_unstable_native_tabs
- ref_path
- ref_readline

## God Nodes (most connected - your core abstractions)
1. `LLMProvider` - 37 edges
2. `LLMChatResult` - 32 edges
3. `openDb()` - 32 edges
4. `Gateway` - 31 edges
5. `SimulatedAdapter` - 30 edges
6. `LLMChatInput` - 28 edges
7. `Db` - 27 edges
8. `ProviderError` - 25 edges
9. `createRegistry()` - 25 edges
10. `SherpaWakeWordService` - 24 edges

## Surprising Connections (you probably didn't know these)
- `Added` --references--> `PathuWakeForegroundService`  [INFERRED]
  docs/CHANGELOG.md → mobile/pathu/modules/pathu-wake-fgs/android/src/main/java/expo/modules/pathuwakefgs/PathuWakeForegroundService.kt
- `Phase 7B.1 — Android microphone foreground service / locked-screen wake baseline` --references--> `PathuWakeForegroundService`  [INFERRED]
  docs/PROJECT_DOCUMENTATION.md → mobile/pathu/modules/pathu-wake-fgs/android/src/main/java/expo/modules/pathuwakefgs/PathuWakeForegroundService.kt
- `Behavior` --references--> `executeDeviceAction()`  [INFERRED]
  docs/CHANGELOG.md → src/ai/deviceActions.ts
- `Added` --references--> `ProviderRouter`  [INFERRED]
  docs/CHANGELOG.md → src/ai/router.ts
- `Data model` --references--> `executeDeviceAction()`  [INFERRED]
  docs/PROJECT_DOCUMENTATION.md → src/ai/deviceActions.ts

## Import Cycles
- None detected.

## Communities (59 total, 15 thin omitted)

### Community 0 - "ai/tools.ts"
Cohesion: 0.09
Nodes (31): powerSchema, setAcSchema, setFanSchema, setLightsSchema, setRgbSchema, validateDeviceAction(), cancelTaskSchema, cancelTaskTool() (+23 more)

### Community 1 - "db/index.ts"
Cohesion: 0.07
Nodes (66): dotenv, ref_node_fs, ref_node_os, ref_node_path, ref_node_sqlite, ref_node_url, vitest, buildProviderMessages() (+58 more)

### Community 2 - "geminiProvider.ts"
Cohesion: 0.22
Nodes (10): classifyGeminiError(), fromGeminiResponse(), GeminiClientLike, GeminiGenerateContent, GeminiProvider, parseToolArgs(), toGeminiRequest(), toGeminiTools() (+2 more)

### Community 3 - "voice.wake.test.ts"
Cohesion: 0.07
Nodes (25): DEFAULT_WAKE_PHRASES, escapeRegExp(), extractCommandAfterWake(), findWakeMatch(), matchesWakePhrase(), normalizeSpeech(), canAcceptCommand(), createVoiceMachineState() (+17 more)

### Community 4 - "youtube/tools.ts"
Cohesion: 0.09
Nodes (38): ClientAction, clientActionSchema, parseClientAction(), YOUTUBE_ACTIONS, YoutubeAction, YoutubeClientAction, youtubeClientActionBase, youtubeClientActionSchema (+30 more)

### Community 5 - "expo"
Cohesion: 0.07
Nodes (26): backgroundColor, backgroundImage, foregroundImage, monochromeImage, adaptiveIcon, package, permissions, predictiveBackGestureEnabled (+18 more)

### Community 6 - "package.json"
Cohesion: 0.06
Nodes (30): allowScripts, esbuild@0.28.2, dependencies, dotenv, @google/genai, hono, @hono/node-server, openai (+22 more)

### Community 7 - "routines/service.ts"
Cohesion: 0.20
Nodes (19): createRoutineService(), createRoutineWithStatements(), deleteRoutineWithStatements(), findRoutinesByNameWithStatements(), getRoutineWithStatements(), listRoutinesWithStatements(), RoutineRow, RoutineStatements (+11 more)

### Community 8 - "router.ts"
Cohesion: 0.15
Nodes (16): classifyCooldownReason(), CooldownReason, errorMessage(), extractErrorStatus(), isCooldownTriggerError(), ProviderCooldownRegistry, ProviderCooldownState, sanitizeForLog() (+8 more)

### Community 9 - "Endpoints"
Cohesion: 0.10
Nodes (19): Audius music (restricted), Endpoints, `GET /devices`, `GET /health`, `GET /music/stream/:trackId`, `GET /routines`, `GET /tasks`, `GET /voice` (+11 more)

### Community 10 - "LLMProvider"
Cohesion: 0.14
Nodes (11): LLMChatInput, LLMChatResult, LLMProvider, ScriptedProvider, CaptureProvider, ScriptedProvider, MockProvider, MockProvider (+3 more)

### Community 11 - "Changelog"
Cohesion: 0.05
Nodes (37): Added, Added, Added, Added, Added, Added, Added, Behavior (+29 more)

### Community 12 - "ai/types.ts"
Cohesion: 0.60
Nodes (3): MAX_HISTORY_MESSAGES, selectRecentHistory(), ChatMessage

### Community 13 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noEmit, resolveJsonModule (+6 more)

### Community 14 - "PathuWakeForegroundService"
Cohesion: 0.08
Nodes (23): Bundle, Context, contextcompat, IBinder, Intent, intentfilter, log, manifest (+15 more)

### Community 15 - "voice-core.js"
Cohesion: 0.27
Nodes (9): createTranscriptWakeDetector(), ensureRecognition(), processTranscript(), createVoiceMachineState(), escapeRegExp(), extractCommandAfterWake(), findWakeMatch(), normalizeSpeech() (+1 more)

### Community 16 - "Pathu — Project Documentation"
Cohesion: 0.07
Nodes (24): Architecture, Chat contract (unchanged), Compatibility names, Config, Data model, Dev command, Execution, Graphify (+16 more)

### Community 18 - "SherpaWakeWordService"
Cohesion: 0.21
Nodes (7): emptyAudio(), SherpaWakeWordService, WakeAudioDiagnostics, WakeDetectionEvent, WakeWordPermission, WakeWordState, WakeWordStatus

### Community 19 - "routes.ts"
Cohesion: 0.08
Nodes (41): zod, chatBodySchema, createRoutineBodySchema, routineActionSchema, updateRoutineBodySchema, VOICE_CORE_JS_PATH, VOICE_HTML_PATH, Config (+33 more)

### Community 20 - "dependencies"
Cohesion: 0.07
Nodes (28): dependencies, expo, expo-asset, expo-constants, expo-dev-client, expo-file-system, expo-font, expo-glass-effect (+20 more)

### Community 22 - "pathu/package.json"
Cohesion: 0.07
Nodes (27): expo, react, react-native, typescript, main, name, private, version (+19 more)

### Community 23 - "SpeechRecognitionServiceImpl"
Cohesion: 0.12
Nodes (11): emptyStatus(), SpeechRecognitionServiceImpl, Listener, speechTts, SpeechTtsServiceImpl, SpeechRecognitionMode, SpeechRecognitionState, SpeechRecognitionStatus (+3 more)

### Community 24 - "WakeForegroundServiceController"
Cohesion: 0.41
Nodes (3): getNative(), normalize(), WakeForegroundServiceController

### Community 25 - "VoiceConversationController.ts"
Cohesion: 0.13
Nodes (21): FALLBACK, PathuWakeFgsNativeModule, WakeFgsSnapshot, WakeFgsStateName, wakeForegroundService, mobile_pathu_src_api_client_pathuapierror, Listener, speechRecognition (+13 more)

### Community 26 - "tasks/service.ts"
Cohesion: 0.21
Nodes (21): ref_node_crypto, createTaskService(), cancelTaskWithStatements(), createTaskWithStatements(), getNextPendingWithStatements(), getTaskWithStatements(), listPendingDueWithStatements(), listTasksWithStatements() (+13 more)

### Community 27 - "DeviceGateway"
Cohesion: 0.16
Nodes (9): Architecture, executeDeviceAction(), ToolContext, AppDeps, DeviceGateway, RoutineToolContext, TaskSchedulerOptions, TaskService (+1 more)

### Community 28 - "index.tsx"
Cohesion: 0.17
Nodes (18): chat(), fetchJson(), mobile_pathu_src_api_client_getapibaseurl, getHealth(), getApiBaseUrl(), ApiErrorBody, ChatRequest, ChatSuccessResponse (+10 more)

### Community 29 - "VoiceConversationControllerImpl"
Cohesion: 0.25
Nodes (8): phaseToLabel(), VoiceConversationStatus, VoiceDiagEvent, VoicePhase, VoiceUiLabel, delay(), now(), VoiceConversationControllerImpl

### Community 30 - "pathu-wake-fgs/package.json"
Cohesion: 0.15
Nodes (12): expo, react, react-native, main, name, peerDependencies, expo, react (+4 more)

### Community 32 - "time.ts"
Cohesion: 0.42
Nodes (9): addCalendarDays(), getZonedParts(), nextDaily(), nextOccurrence(), nextWeekly(), parseDueAt(), WEEKDAY_MAP, zonedLocalToUtc() (+1 more)

### Community 33 - "devDependencies"
Cohesion: 0.50
Nodes (4): devDependencies, patch-package, @types/react, typescript

### Community 35 - "pathu/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, paths, strict, extends, include, @/assets/*, expo/tsconfig.base

### Community 36 - "SherpaWakeWord.ts"
Cohesion: 0.17
Nodes (15): copyAssetToDir(), ensureKwsModelsOnDisk(), MODEL_ASSETS, PreparedKwsModels, analyzeMicCapture(), buildWavBase64(), decodeChunks(), MicDiagnosticResult (+7 more)

### Community 37 - "USB Android development"
Cohesion: 0.20
Nodes (9): API URL, Architecture, DEV diagnostics (Diagnostics panel, `__DEV__` only), Endpoints used, Pathu (mobile), Phase 7B.1 — locked-screen wake baseline, Status, USB Android development (+1 more)

### Community 38 - "AGENTS.md"
Cohesion: 0.33
Nodes (5): Building with EAS, Commands, Expo has changed — do not trust your training data, Navigation & Routing, Rules

### Community 40 - "openRouterProvider.ts"
Cohesion: 0.22
Nodes (10): openai, fromOpenRouterMessage(), OPENROUTER_DEFAULT_BASE_URL, OPENROUTER_DEFAULT_MODEL, OpenRouterProvider, parseToolArguments(), toOpenAiTools(), toOpenRouterMessages() (+2 more)

### Community 41 - "metro.config.js"
Cohesion: 0.50
Nodes (3): config, { getDefaultConfig }, ref_expo_metro_config

### Community 42 - "react-native-live-audio-stream.d.ts"
Cohesion: 0.50
Nodes (3): InitOptions, LiveAudioStreamModule, react-native-live-audio-stream

### Community 45 - "_layout.tsx"
Cohesion: 0.40
Nodes (3): expo-router, expo-splash-screen, expo-status-bar

### Community 46 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, android, dev:android, ios, lint, postinstall, start, web

### Community 47 - "createLLMProvider.ts"
Cohesion: 0.26
Nodes (8): createLLMProvider(), createNamedProvider(), OpenAIProvider, parseToolArguments(), toOpenAiMessages(), toOpenAiTools(), NamedLLMProvider, ProviderName

### Community 48 - "ProviderError"
Cohesion: 0.21
Nodes (12): classifyOllamaError(), fromOllamaResponse(), OllamaChatResponse, OllamaFetch, OllamaProvider, OllamaToolCall, parseArgs(), toOllamaMessages() (+4 more)

### Community 49 - "RoutineService"
Cohesion: 0.42
Nodes (3): RoutineService, resolveRoutine(), RoutineRecord

### Community 50 - "micOwnership.ts"
Cohesion: 0.29
Nodes (5): Listener, log(), MicOwner, MicOwnershipState, state

## Knowledge Gaps
- **314 isolated node(s):** `name`, `slug`, `version`, `orientation`, `icon` (+309 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 394 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `now()` connect `VoiceConversationControllerImpl` to `router.ts`, `VoiceConversationController.ts`?**
  _High betweenness centrality (0.231) - this node is a cross-community bridge._
- **Why does `vitest` connect `db/index.ts` to `geminiProvider.ts`, `voice.wake.test.ts`, `youtube/tools.ts`, `package.json`, `openRouterProvider.ts`, `router.ts`, `ai/types.ts`, `ProviderError`, `routes.ts`?**
  _High betweenness centrality (0.187) - this node is a cross-community bridge._
- **Why does `Pathu — Project Documentation` connect `Pathu — Project Documentation` to `DeviceGateway`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **What connects `name`, `slug`, `version` to the rest of the system?**
  _314 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ai/tools.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0944741532976827 - nodes in this community are weakly interconnected._
- **Should `db/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07147802007615092 - nodes in this community are weakly interconnected._
- **Should `voice.wake.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06717687074829932 - nodes in this community are weakly interconnected._