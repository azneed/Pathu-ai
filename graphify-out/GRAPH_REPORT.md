# Graph Report - andru  (2026-10-02)

## Corpus Check
- 129 files · ~97,818 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 4, .xml 4, .example 2)

## Summary
- 1270 nodes · 2847 edges · 78 communities (58 shown, 20 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b0de55bc`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ai/tools.ts
- openDb
- geminiProvider.ts
- voice.wake.test.ts
- youtube/tools.ts
- expo
- package.json
- routines/service.ts
- router.ts
- Endpoints
- LLMChatResult
- Changelog
- createLLMProvider.ts
- compilerOptions
- PathuWakeForegroundService
- voice-core.js
- Pathu — Project Documentation
- ref_vitest_config
- SherpaWakeWordService
- music/tools.ts
- dependencies
- src_ai_provider_llmprovider
- pathu/package.json
- SpeechRecognitionServiceImpl
- WakeForegroundServiceController
- _layout.tsx
- tasks/service.ts
- TaskService
- PathuVoiceInteractionSession
- index.tsx
- pathu-wake-fgs/package.json
- ref_fs
- routines.test.ts
- HeyJarvisDetector
- mobile_pathu_src_components_animated_icon_module
- pathu/tsconfig.json
- Forwarder
- USB Android development
- AGENTS.md
- ProviderError
- metro.config.js
- react-native-live-audio-stream.d.ts
- wakeword/README.md
- AssistantWakeLoop.kt
- VoiceConversationController.ts
- LLMProvider
- ollamaProvider.ts
- routines/tools.ts
- PathuVoiceInteractionService.kt
- simulated.ts
- mobile_pathu_src_global
- mobile_pathu_src_hooks_use_color_scheme_usecolorscheme
- ref_expo_package_json
- ref_expo_router_ui
- ref_expo_router_unstable_native_tabs
- ref_path
- ref_readline
- PathuAssistantForegroundService.kt
- Db
- pathu-assistant/package.json
- AssistantState
- scripts
- routes.ts
- SherpaWakeWord.ts
- PathuAssistantModule.kt
- PathuMusicPlayer
- devDependencies
- VoiceConversationControllerImpl
- time.ts
- pathu-wake-fgs/src/index.ts
- AssistantWakeLoop
- micOwnership.ts
- db/index.ts

## God Nodes (most connected - your core abstractions)
1. `LLMProvider` - 41 edges
2. `LLMChatResult` - 36 edges
3. `openDb()` - 36 edges
4. `Gateway` - 35 edges
5. `SimulatedAdapter` - 34 edges
6. `LLMChatInput` - 32 edges
7. `Db` - 29 edges
8. `createRegistry()` - 29 edges
9. `vitest` - 25 edges
10. `ProviderError` - 25 edges

## Surprising Connections (you probably didn't know these)
- `Behavior` --references--> `executeDeviceAction()`  [INFERRED]
  docs/CHANGELOG.md → src/ai/deviceActions.ts
- `Added` --references--> `ProviderRouter`  [INFERRED]
  docs/CHANGELOG.md → src/ai/router.ts
- `Architecture` --references--> `executeDeviceAction()`  [INFERRED]
  docs/PROJECT_DOCUMENTATION.md → src/ai/deviceActions.ts
- `Modules` --references--> `openDb()`  [INFERRED]
  docs/PROJECT_DOCUMENTATION.md → src/db/index.ts
- `Architecture` --references--> `DeviceGateway`  [INFERRED]
  docs/PROJECT_DOCUMENTATION.md → src/devices/types.ts

## Import Cycles
- None detected.

## Communities (78 total, 20 thin omitted)

### Community 0 - "ai/tools.ts"
Cohesion: 0.15
Nodes (16): Data model, zod, executeDeviceAction(), powerSchema, setAcSchema, setFanSchema, setLightsSchema, setRgbSchema (+8 more)

### Community 1 - "openDb"
Cohesion: 0.27
Nodes (23): ref_node_fs, ref_node_os, ref_node_path, vitest, openDb(), Gateway, createRegistry(), SimulatedAdapter (+15 more)

### Community 2 - "geminiProvider.ts"
Cohesion: 0.23
Nodes (9): @google/genai, classifyGeminiError(), fromGeminiResponse(), GeminiClientLike, GeminiGenerateContent, GeminiProvider, parseToolArgs(), toGeminiRequest() (+1 more)

### Community 3 - "voice.wake.test.ts"
Cohesion: 0.07
Nodes (25): DEFAULT_WAKE_PHRASES, escapeRegExp(), extractCommandAfterWake(), findWakeMatch(), matchesWakePhrase(), normalizeSpeech(), canAcceptCommand(), createVoiceMachineState() (+17 more)

### Community 4 - "youtube/tools.ts"
Cohesion: 0.08
Nodes (40): ClientAction, clientActionSchema, parseClientAction(), YOUTUBE_ACTIONS, YoutubeAction, YoutubeClientAction, youtubeClientActionBase, youtubeClientActionSchema (+32 more)

### Community 5 - "expo"
Cohesion: 0.07
Nodes (26): backgroundColor, backgroundImage, foregroundImage, monochromeImage, adaptiveIcon, package, permissions, predictiveBackGestureEnabled (+18 more)

### Community 6 - "package.json"
Cohesion: 0.06
Nodes (30): dependencies, dotenv, @google/genai, hono, @hono/node-server, openai, zod, devDependencies (+22 more)

### Community 7 - "routines/service.ts"
Cohesion: 0.21
Nodes (18): createRoutineService(), createRoutineWithStatements(), deleteRoutineWithStatements(), findRoutinesByNameWithStatements(), getRoutineWithStatements(), listRoutinesWithStatements(), RoutineRow, RoutineStatements (+10 more)

### Community 8 - "router.ts"
Cohesion: 0.14
Nodes (18): classifyCooldownReason(), CooldownReason, errorMessage(), extractErrorStatus(), isCooldownTriggerError(), ProviderCooldownRegistry, ProviderCooldownState, sanitizeForLog() (+10 more)

### Community 9 - "Endpoints"
Cohesion: 0.10
Nodes (20): Audius music (restricted), Endpoints, `GET /devices`, `GET /health`, `GET /music/stream/:trackId`, `GET /routines`, `GET /tasks`, `GET /voice` (+12 more)

### Community 10 - "LLMChatResult"
Cohesion: 0.14
Nodes (6): LLMChatResult, ScriptedProvider, ScriptedProvider, ScriptedProvider, ScriptedProvider, ScriptedProvider

### Community 11 - "Changelog"
Cohesion: 0.05
Nodes (37): Added, Added, Added, Added, Added, Added, Behavior, Changed (+29 more)

### Community 12 - "createLLMProvider.ts"
Cohesion: 0.19
Nodes (11): openai, createLLMProvider(), createNamedProvider(), OpenAIProvider, parseToolArguments(), toOpenAiMessages(), toOpenAiTools(), NamedLLMProvider (+3 more)

### Community 13 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noEmit, resolveJsonModule (+6 more)

### Community 14 - "PathuWakeForegroundService"
Cohesion: 0.11
Nodes (15): Added, Phase 7B.1 — Android microphone foreground service / locked-screen wake baseline, BroadcastReceiver, Context, IBinder, Intent, Notification, PowerManager (+7 more)

### Community 15 - "voice-core.js"
Cohesion: 0.27
Nodes (9): createTranscriptWakeDetector(), ensureRecognition(), processTranscript(), createVoiceMachineState(), escapeRegExp(), extractCommandAfterWake(), findWakeMatch(), normalizeSpeech() (+1 more)

### Community 16 - "Pathu — Project Documentation"
Cohesion: 0.07
Nodes (23): Architecture, Architecture, Chat contract (unchanged), Compatibility names, Config, Dev command, Execution, Graphify (+15 more)

### Community 18 - "SherpaWakeWordService"
Cohesion: 0.25
Nodes (5): emptyAudio(), SherpaWakeWordService, WakeDetectionEvent, WakeWordPermission, WakeWordState

### Community 19 - "music/tools.ts"
Cohesion: 0.12
Nodes (31): AudiusClientOptions, headers(), musicStreamPathFor(), requireKey(), resolveAudiusStreamUrl(), searchAudiusTracks(), audiusTrackIdSchema, MUSIC_ACTIONS (+23 more)

### Community 20 - "dependencies"
Cohesion: 0.07
Nodes (28): dependencies, expo, expo-asset, expo-constants, expo-dev-client, expo-file-system, expo-font, expo-glass-effect (+20 more)

### Community 22 - "pathu/package.json"
Cohesion: 0.07
Nodes (27): expo, react, react-native, typescript, main, name, private, version (+19 more)

### Community 23 - "SpeechRecognitionServiceImpl"
Cohesion: 0.13
Nodes (10): SpeechRecognitionServiceImpl, Listener, speechTts, SpeechTtsServiceImpl, SpeechRecognitionMode, SpeechRecognitionState, SpeechRecognitionStatus, SpeechTtsState (+2 more)

### Community 24 - "WakeForegroundServiceController"
Cohesion: 0.41
Nodes (3): getNative(), normalize(), WakeForegroundServiceController

### Community 25 - "_layout.tsx"
Cohesion: 0.33
Nodes (4): expo-router, expo-splash-screen, expo-status-bar, ref_react

### Community 26 - "tasks/service.ts"
Cohesion: 0.20
Nodes (22): createTaskService(), cancelTaskWithStatements(), createTaskWithStatements(), getNextPendingWithStatements(), getTaskWithStatements(), listPendingDueWithStatements(), listTasksWithStatements(), markTaskFinishedWithStatements() (+14 more)

### Community 27 - "TaskService"
Cohesion: 0.33
Nodes (3): ToolContext, TaskService, TaskRecord

### Community 28 - "PathuVoiceInteractionSession"
Cohesion: 0.08
Nodes (18): color, gravity, linearlayout, locale, Bundle, ByteArray, SpeechRecognizer, PathuVoiceInteractionSession (+10 more)

### Community 29 - "index.tsx"
Cohesion: 0.16
Nodes (20): chat(), fetchJson(), mobile_pathu_src_api_client_getapibaseurl, getHealth(), mobile_pathu_src_api_client_pathuapierror, getApiBaseUrl(), getApiSecret(), ApiErrorBody (+12 more)

### Community 30 - "pathu-wake-fgs/package.json"
Cohesion: 0.15
Nodes (12): expo, react, react-native, main, name, peerDependencies, expo, react (+4 more)

### Community 32 - "routines.test.ts"
Cohesion: 0.18
Nodes (5): AppDeps, DeviceGateway, TaskSchedulerOptions, get(), getAll()

### Community 33 - "HeyJarvisDetector"
Cohesion: 0.19
Nodes (9): ByteBuffer, byteorder, Closeable, FloatArray, Interpreter, HeyJarvisDetector, Context, ShortArray (+1 more)

### Community 35 - "pathu/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, paths, strict, extends, include, @/assets/*, expo/tsconfig.base

### Community 36 - "Forwarder"
Cohesion: 0.13
Nodes (13): Callback, ComponentName, Forwarder, Bundle, ByteArray, Context, Intent, SpeechRecognizer (+5 more)

### Community 37 - "USB Android development"
Cohesion: 0.18
Nodes (10): API URL, Architecture, Dependencies (pnpm), DEV diagnostics (Diagnostics panel, `__DEV__` only), Endpoints used, Pathu (mobile), Phase 7B.1 — locked-screen wake baseline, Status (+2 more)

### Community 38 - "AGENTS.md"
Cohesion: 0.33
Nodes (5): Building with EAS, Commands, Expo has changed — do not trust your training data, Navigation & Routing, Rules

### Community 40 - "ProviderError"
Cohesion: 0.24
Nodes (10): fromOpenRouterMessage(), OPENROUTER_DEFAULT_BASE_URL, OPENROUTER_DEFAULT_MODEL, OpenRouterProvider, parseToolArguments(), toOpenAiTools(), toOpenRouterMessages(), ProviderError (+2 more)

### Community 41 - "metro.config.js"
Cohesion: 0.50
Nodes (3): config, { getDefaultConfig }, ref_expo_metro_config

### Community 42 - "react-native-live-audio-stream.d.ts"
Cohesion: 0.50
Nodes (3): InitOptions, LiveAudioStreamModule, react-native-live-audio-stream

### Community 45 - "AssistantWakeLoop.kt"
Cohesion: 0.11
Nodes (18): audioformat, audiorecord, build, concurrenthashmap, context, contextcompat, file, intent (+10 more)

### Community 46 - "VoiceConversationController.ts"
Cohesion: 0.13
Nodes (21): emptyStatus(), Listener, speechRecognition, Subscription, micOwnership, phaseToLabel(), VoiceConversationStatus, VoiceDiagEvent (+13 more)

### Community 47 - "LLMProvider"
Cohesion: 0.17
Nodes (16): buildProviderMessages(), extractClientAction(), runChat(), MAX_HISTORY_MESSAGES, selectRecentHistory(), buildSystemPrompt(), formatDeviceStateContext(), SYSTEM_PROMPT (+8 more)

### Community 48 - "ollamaProvider.ts"
Cohesion: 0.26
Nodes (9): classifyOllamaError(), fromOllamaResponse(), OllamaChatResponse, OllamaFetch, OllamaProvider, OllamaToolCall, parseArgs(), toOllamaMessages() (+1 more)

### Community 49 - "routines/tools.ts"
Cohesion: 0.15
Nodes (14): RoutineService, createRoutineSchema, deleteRoutineSchema, deviceActionSchema, executeRoutineTool(), listRoutinesSchema, resolveRoutine(), ROUTINE_TOOL_NAMES (+6 more)

### Community 50 - "PathuVoiceInteractionService.kt"
Cohesion: 0.16
Nodes (10): handler, intentfilter, looper, BroadcastReceiver, Context, Intent, PathuVoiceInteractionService, BroadcastReceiver (+2 more)

### Community 51 - "simulated.ts"
Cohesion: 0.14
Nodes (20): applyAc(), applyFan(), applyLights(), applyRgb(), assertIntegerInRange(), clamp(), KIND_BY_ID, AcCommand (+12 more)

### Community 59 - "PathuAssistantForegroundService.kt"
Cohesion: 0.16
Nodes (11): activity, activitymanager, application, Context, IBinder, Intent, Notification, PowerManager (+3 more)

### Community 60 - "Db"
Cohesion: 0.18
Nodes (7): ChatResult, Db, DeviceCommand, DeviceId, DeviceRecord, DeviceState, isDeviceId()

### Community 61 - "pathu-assistant/package.json"
Cohesion: 0.15
Nodes (12): expo, react, react-native, main, name, peerDependencies, expo, react (+4 more)

### Community 63 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, android, dev:android, ios, lint, postinstall, start, web

### Community 64 - "routes.ts"
Cohesion: 0.11
Nodes (23): hono, ref_node_crypto, apiAuth(), assertAuthForHost(), digest(), isLoopbackHost(), isPublicRoute(), chatBodySchema (+15 more)

### Community 65 - "SherpaWakeWord.ts"
Cohesion: 0.17
Nodes (15): copyAssetToDir(), ensureKwsModelsOnDisk(), MODEL_ASSETS, PreparedKwsModels, analyzeMicCapture(), buildWavBase64(), decodeChunks(), MicDiagnosticResult (+7 more)

### Community 66 - "PathuAssistantModule.kt"
Cohesion: 0.40
Nodes (4): bundle, Module, PathuAssistantModule, moduledefinition

### Community 67 - "PathuMusicPlayer"
Cohesion: 0.09
Nodes (21): audioattributes, c, defaulthttpdatasource, defaultmediasourcefactory, ExoPlayer, httpurlconnection, JSONArray, jsonobject (+13 more)

### Community 68 - "devDependencies"
Cohesion: 0.50
Nodes (4): devDependencies, patch-package, @types/react, typescript

### Community 73 - "time.ts"
Cohesion: 0.25
Nodes (15): createTaskTool(), executeTool(), getTasksTool(), addCalendarDays(), CurrentTimeInfo, describeCurrentTime(), formatInstantForZone(), getZonedParts() (+7 more)

### Community 74 - "pathu-wake-fgs/src/index.ts"
Cohesion: 0.20
Nodes (11): getAssistantStatus(), getNative(), PathuAssistantNativeModule, PathuAssistantStatus, FALLBACK, PathuWakeFgsNativeModule, WakeFgsSnapshot, WakeFgsStateName (+3 more)

### Community 76 - "micOwnership.ts"
Cohesion: 0.29
Nodes (5): Listener, log(), MicOwner, MicOwnershipState, state

### Community 77 - "db/index.ts"
Cohesion: 0.33
Nodes (5): ref_node_sqlite, ref_node_url, SCHEMA_PATH, prepareRoutineStatements(), prepareTaskStatements()

## Knowledge Gaps
- **331 isolated node(s):** `name`, `slug`, `version`, `orientation`, `icon` (+326 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 444 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Pathu — Project Documentation` connect `Pathu — Project Documentation` to `PathuWakeForegroundService`?**
  _High betweenness centrality (0.267) - this node is a cross-community bridge._
- **Why does `Phase 7B.1 — Android microphone foreground service / locked-screen wake baseline` connect `PathuWakeForegroundService` to `Pathu — Project Documentation`?**
  _High betweenness centrality (0.252) - this node is a cross-community bridge._
- **What connects `name`, `slug`, `version` to the rest of the system?**
  _331 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `voice.wake.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06717687074829932 - nodes in this community are weakly interconnected._
- **Should `youtube/tools.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08067375886524823 - nodes in this community are weakly interconnected._
- **Should `expo` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._