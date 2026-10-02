# Graph Report - andru  (2026-10-02)

## Corpus Check
- 125 files · ~94,925 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 12 file(s) not represented in the graph (top: (none) 4, .xml 4, .example 2)

## Summary
- 1212 nodes · 2660 edges · 72 communities (55 shown, 17 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0394a72e`
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
- LLMChatResult
- Changelog
- ai/types.ts
- compilerOptions
- PathuWakeForegroundService
- voice-core.js
- Pathu — Project Documentation
- ref_vitest_config
- SherpaWakeWord.ts
- music/tools.ts
- dependencies
- src_ai_provider_llmprovider
- pathu/package.json
- SpeechRecognitionServiceImpl
- WakeForegroundServiceController
- _layout.tsx
- tasks/service.ts
- TaskService
- PathuVoiceInteractionSessionService.kt
- VoiceConversationController.ts
- pathu-wake-fgs/package.json
- ref_fs
- DeviceGateway
- AssistantWakeLoop
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
- music.test.ts
- LLMProvider
- ollamaProvider.ts
- routines/tools.ts
- PathuVoiceInteractionService.kt
- PathuAssistantForegroundService.kt
- mobile_pathu_src_global
- mobile_pathu_src_hooks_use_color_scheme_usecolorscheme
- ref_expo_package_json
- ref_expo_router_ui
- ref_expo_router_unstable_native_tabs
- ref_path
- ref_readline
- PathuAssistantForegroundService
- youtube.playbackTruth.test.ts
- pathu-assistant/package.json
- AssistantState.kt
- scripts
- routes.ts
- audius.ts
- PathuAssistantModule.kt
- PathuChatClient.kt
- devDependencies

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
- `Behavior` --references--> `executeDeviceAction()`  [INFERRED]
  docs/CHANGELOG.md → src/ai/deviceActions.ts
- `Added` --references--> `ProviderRouter`  [INFERRED]
  docs/CHANGELOG.md → src/ai/router.ts
- `Data model` --references--> `validateDeviceAction()`  [INFERRED]
  docs/PROJECT_DOCUMENTATION.md → src/ai/deviceActions.ts
- `Modules` --references--> `openDb()`  [INFERRED]
  docs/PROJECT_DOCUMENTATION.md → src/db/index.ts
- `Added` --references--> `PathuWakeForegroundService`  [INFERRED]
  docs/CHANGELOG.md → mobile/pathu/modules/pathu-wake-fgs/android/src/main/java/expo/modules/pathuwakefgs/PathuWakeForegroundService.kt

## Import Cycles
- None detected.

## Communities (72 total, 17 thin omitted)

### Community 0 - "ai/tools.ts"
Cohesion: 0.11
Nodes (27): powerSchema, setAcSchema, setFanSchema, setLightsSchema, setRgbSchema, cancelTaskSchema, cancelTaskTool(), createTaskSchema (+19 more)

### Community 1 - "db/index.ts"
Cohesion: 0.07
Nodes (71): dotenv, ref_node_fs, ref_node_os, ref_node_path, ref_node_sqlite, ref_node_url, vitest, buildProviderMessages() (+63 more)

### Community 2 - "geminiProvider.ts"
Cohesion: 0.24
Nodes (9): classifyGeminiError(), fromGeminiResponse(), GeminiClientLike, GeminiGenerateContent, GeminiProvider, parseToolArgs(), toGeminiRequest(), toGeminiTools() (+1 more)

### Community 3 - "voice.wake.test.ts"
Cohesion: 0.07
Nodes (25): DEFAULT_WAKE_PHRASES, escapeRegExp(), extractCommandAfterWake(), findWakeMatch(), matchesWakePhrase(), normalizeSpeech(), canAcceptCommand(), createVoiceMachineState() (+17 more)

### Community 4 - "youtube/tools.ts"
Cohesion: 0.19
Nodes (18): ClientAction, searchYoutubeVideos(), YoutubeSearchOptions, emptyState(), getYoutubeSession(), rememberPlay(), rememberSearchResults(), resetYoutubeSession() (+10 more)

### Community 5 - "expo"
Cohesion: 0.07
Nodes (26): backgroundColor, backgroundImage, foregroundImage, monochromeImage, adaptiveIcon, package, permissions, predictiveBackGestureEnabled (+18 more)

### Community 6 - "package.json"
Cohesion: 0.07
Nodes (29): dependencies, dotenv, @google/genai, hono, @hono/node-server, openai, zod, devDependencies (+21 more)

### Community 7 - "routines/service.ts"
Cohesion: 0.23
Nodes (16): createRoutineService(), createRoutineWithStatements(), deleteRoutineWithStatements(), findRoutinesByNameWithStatements(), getRoutineWithStatements(), listRoutinesWithStatements(), RoutineRow, RoutineStatements (+8 more)

### Community 8 - "router.ts"
Cohesion: 0.16
Nodes (15): classifyCooldownReason(), CooldownReason, errorMessage(), extractErrorStatus(), isCooldownTriggerError(), ProviderCooldownRegistry, ProviderCooldownState, sanitizeForLog() (+7 more)

### Community 9 - "Endpoints"
Cohesion: 0.10
Nodes (20): Audius music (restricted), Endpoints, `GET /devices`, `GET /health`, `GET /music/stream/:trackId`, `GET /routines`, `GET /tasks`, `GET /voice` (+12 more)

### Community 10 - "LLMChatResult"
Cohesion: 0.16
Nodes (8): LLMChatInput, LLMChatResult, ScriptedProvider, CaptureProvider, ScriptedProvider, ScriptedProvider, ScriptedProvider, ScriptedProvider

### Community 11 - "Changelog"
Cohesion: 0.05
Nodes (37): Added, Added, Added, Added, Added, Added, Behavior, Changed (+29 more)

### Community 12 - "ai/types.ts"
Cohesion: 0.20
Nodes (9): openai, MAX_HISTORY_MESSAGES, selectRecentHistory(), parseToolArguments(), toOpenAiMessages(), toOpenAiTools(), ChatMessage, ToolCall (+1 more)

### Community 13 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noEmit, resolveJsonModule (+6 more)

### Community 14 - "PathuWakeForegroundService"
Cohesion: 0.16
Nodes (8): Added, Phase 7B.1 — Android microphone foreground service / locked-screen wake baseline, BroadcastReceiver, Notification, PowerManager, Service, PathuWakeForegroundService, BroadcastReceiver

### Community 15 - "voice-core.js"
Cohesion: 0.27
Nodes (9): createTranscriptWakeDetector(), ensureRecognition(), processTranscript(), createVoiceMachineState(), escapeRegExp(), extractCommandAfterWake(), findWakeMatch(), normalizeSpeech() (+1 more)

### Community 16 - "Pathu — Project Documentation"
Cohesion: 0.09
Nodes (18): Architecture, Chat contract (unchanged), Compatibility names, Config, Dev command, Graphify, LLM provider cooldown, Media (+10 more)

### Community 18 - "SherpaWakeWord.ts"
Cohesion: 0.06
Nodes (48): getAssistantStatus(), getNative(), PathuAssistantNativeModule, PathuAssistantStatus, FALLBACK, PathuWakeFgsNativeModule, WakeFgsSnapshot, WakeFgsStateName (+40 more)

### Community 19 - "music/tools.ts"
Cohesion: 0.20
Nodes (17): musicStreamPathFor(), parseMusicClientAction(), emptyState(), getMusicSession(), MusicSessionState, rememberMusicPlay(), rememberMusicSearch(), resetMusicSession() (+9 more)

### Community 20 - "dependencies"
Cohesion: 0.07
Nodes (28): dependencies, expo, expo-asset, expo-constants, expo-dev-client, expo-file-system, expo-font, expo-glass-effect (+20 more)

### Community 22 - "pathu/package.json"
Cohesion: 0.08
Nodes (25): expo, react, react-native, typescript, main, name, private, version (+17 more)

### Community 23 - "SpeechRecognitionServiceImpl"
Cohesion: 0.10
Nodes (15): emptyStatus(), Listener, speechRecognition, SpeechRecognitionServiceImpl, Subscription, Listener, speechTts, SpeechTtsServiceImpl (+7 more)

### Community 24 - "WakeForegroundServiceController"
Cohesion: 0.41
Nodes (3): getNative(), normalize(), WakeForegroundServiceController

### Community 25 - "_layout.tsx"
Cohesion: 0.33
Nodes (4): expo-router, expo-splash-screen, expo-status-bar, ref_react

### Community 26 - "tasks/service.ts"
Cohesion: 0.28
Nodes (17): ref_node_crypto, createTaskService(), cancelTaskWithStatements(), createTaskWithStatements(), getNextPendingWithStatements(), getTaskWithStatements(), listPendingDueWithStatements(), listTasksWithStatements() (+9 more)

### Community 27 - "TaskService"
Cohesion: 0.31
Nodes (3): TaskSchedulerOptions, TaskService, TaskRecord

### Community 28 - "PathuVoiceInteractionSessionService.kt"
Cohesion: 0.08
Nodes (18): color, gravity, linearlayout, locale, Bundle, ByteArray, SpeechRecognizer, PathuVoiceInteractionSession (+10 more)

### Community 29 - "VoiceConversationController.ts"
Cohesion: 0.11
Nodes (27): chat(), fetchJson(), mobile_pathu_src_api_client_getapibaseurl, getHealth(), mobile_pathu_src_api_client_pathuapierror, getApiBaseUrl(), ApiErrorBody, ChatRequest (+19 more)

### Community 30 - "pathu-wake-fgs/package.json"
Cohesion: 0.15
Nodes (12): expo, react, react-native, main, name, peerDependencies, expo, react (+4 more)

### Community 32 - "DeviceGateway"
Cohesion: 0.12
Nodes (13): Architecture, Data model, Execution, REST, Routines / scenes (Phase 4), Tools, executeDeviceAction(), ToolContext (+5 more)

### Community 33 - "AssistantWakeLoop"
Cohesion: 0.11
Nodes (11): ByteBuffer, byteorder, Closeable, FloatArray, Interpreter, AssistantWakeLoop, ShortArray, HeyJarvisDetector (+3 more)

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
Cohesion: 0.26
Nodes (9): fromOpenRouterMessage(), OPENROUTER_DEFAULT_BASE_URL, OPENROUTER_DEFAULT_MODEL, OpenRouterProvider, parseToolArguments(), toOpenAiTools(), toOpenRouterMessages(), ProviderError (+1 more)

### Community 41 - "metro.config.js"
Cohesion: 0.50
Nodes (3): config, { getDefaultConfig }, ref_expo_metro_config

### Community 42 - "react-native-live-audio-stream.d.ts"
Cohesion: 0.50
Nodes (3): InitOptions, LiveAudioStreamModule, react-native-live-audio-stream

### Community 45 - "AssistantWakeLoop.kt"
Cohesion: 0.14
Nodes (13): audioformat, audiorecord, concurrenthashmap, context, file, intent, manifest, mediarecorder (+5 more)

### Community 46 - "music.test.ts"
Cohesion: 0.15
Nodes (14): audiusTrackIdSchema, MUSIC_ACTIONS, musicBase, MusicClientAction, musicClientActionSchema, musicStreamPathSchema, clientActionSchema, parseClientAction() (+6 more)

### Community 47 - "LLMProvider"
Cohesion: 0.17
Nodes (11): createLLMProvider(), createNamedProvider(), OllamaProvider, OpenAIProvider, NamedLLMProvider, ProviderName, LLMProvider, MockProvider (+3 more)

### Community 48 - "ollamaProvider.ts"
Cohesion: 0.26
Nodes (9): classifyOllamaError(), fromOllamaResponse(), OllamaChatResponse, OllamaFetch, OllamaToolCall, parseArgs(), toOllamaMessages(), toOllamaTools() (+1 more)

### Community 49 - "routines/tools.ts"
Cohesion: 0.11
Nodes (21): validateDeviceAction(), createRoutineSchema, deleteRoutineSchema, deviceActionSchema, executeRoutineTool(), listRoutinesSchema, ROUTINE_TOOL_NAMES, routineToolDefinitions (+13 more)

### Community 50 - "PathuVoiceInteractionService.kt"
Cohesion: 0.16
Nodes (10): handler, intentfilter, looper, BroadcastReceiver, Context, Intent, PathuVoiceInteractionService, BroadcastReceiver (+2 more)

### Community 51 - "PathuAssistantForegroundService.kt"
Cohesion: 0.18
Nodes (13): activity, activitymanager, application, build, contextcompat, Context, IBinder, Intent (+5 more)

### Community 59 - "PathuAssistantForegroundService"
Cohesion: 0.19
Nodes (7): Context, IBinder, Intent, Notification, PowerManager, Service, PathuAssistantForegroundService

### Community 60 - "youtube.playbackTruth.test.ts"
Cohesion: 0.26
Nodes (12): canClaimPlaying(), enableAudioFailureReply(), EnableAudioPlan, interpretPlayAttempt(), planEnableAudioUnlock(), PLAYBACK_STATUSES, PlaybackStatus, playbackUiLabel() (+4 more)

### Community 61 - "pathu-assistant/package.json"
Cohesion: 0.15
Nodes (12): expo, react, react-native, main, name, peerDependencies, expo, react (+4 more)

### Community 62 - "AssistantState.kt"
Cohesion: 0.24
Nodes (5): log, AssistantState, Context, rolemanager, systemclock

### Community 63 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, android, dev:android, ios, lint, postinstall, start, web

### Community 64 - "routes.ts"
Cohesion: 0.25
Nodes (7): zod, chatBodySchema, createRoutineBodySchema, routineActionSchema, updateRoutineBodySchema, VOICE_CORE_JS_PATH, VOICE_HTML_PATH

### Community 65 - "audius.ts"
Cohesion: 0.48
Nodes (6): AudiusClientOptions, headers(), requireKey(), resolveAudiusStreamUrl(), searchAudiusTracks(), AudiusTrackResult

### Community 66 - "PathuAssistantModule.kt"
Cohesion: 0.40
Nodes (4): bundle, Module, PathuAssistantModule, moduledefinition

### Community 67 - "PathuChatClient.kt"
Cohesion: 0.33
Nodes (4): httpurlconnection, jsonobject, PathuChatClient, url

### Community 68 - "devDependencies"
Cohesion: 0.50
Nodes (4): devDependencies, patch-package, @types/react, typescript

## Knowledge Gaps
- **328 isolated node(s):** `name`, `slug`, `version`, `orientation`, `icon` (+323 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 433 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Pathu — Project Documentation` connect `Pathu — Project Documentation` to `DeviceGateway`, `PathuWakeForegroundService`?**
  _High betweenness centrality (0.267) - this node is a cross-community bridge._
- **Why does `PathuWakeForegroundService` connect `PathuWakeForegroundService` to `PathuAssistantForegroundService.kt`?**
  _High betweenness centrality (0.260) - this node is a cross-community bridge._
- **Why does `Phase 7B.1 — Android microphone foreground service / locked-screen wake baseline` connect `PathuWakeForegroundService` to `Pathu — Project Documentation`?**
  _High betweenness centrality (0.250) - this node is a cross-community bridge._
- **What connects `name`, `slug`, `version` to the rest of the system?**
  _328 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ai/tools.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11494252873563218 - nodes in this community are weakly interconnected._
- **Should `db/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06805019305019305 - nodes in this community are weakly interconnected._
- **Should `voice.wake.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06717687074829932 - nodes in this community are weakly interconnected._