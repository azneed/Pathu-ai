# Graph Report - andru  (2026-09-23)

## Corpus Check
- 74 files · ~40,907 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 2 file(s) not represented in the graph (top: .example 1, (none) 1)

## Summary
- 608 nodes · 1619 edges · 22 communities (20 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 33 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- tasks/service.ts
- index.ts
- routes.ts
- voice.wake.test.ts
- youtube/tools.ts
- simulated.ts
- app.ts
- routines/service.ts
- router.ts
- Andru
- ai/tools.ts
- Changelog
- routines/tools.ts
- compilerOptions
- time.ts
- voice-core.js
- TaskScheduler
- ref_vitest_config
- tasks/types.ts
- DeviceGateway
- RoutineService
- src_ai_provider_llmprovider

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
10. `vitest` - 23 edges

## Surprising Connections (you probably didn't know these)
- `Behavior` --references--> `executeDeviceAction()`  [INFERRED]
  docs/CHANGELOG.md → src/ai/deviceActions.ts
- `Added` --references--> `ProviderRouter`  [INFERRED]
  docs/CHANGELOG.md → src/ai/router.ts
- `Architecture` --references--> `executeDeviceAction()`  [INFERRED]
  docs/PROJECT_DOCUMENTATION.md → src/ai/deviceActions.ts
- `Data model` --references--> `validateDeviceAction()`  [INFERRED]
  docs/PROJECT_DOCUMENTATION.md → src/ai/deviceActions.ts
- `Modules` --references--> `openDb()`  [INFERRED]
  docs/PROJECT_DOCUMENTATION.md → src/db/index.ts

## Import Cycles
- None detected.

## Communities (22 total, 2 thin omitted)

### Community 0 - "tasks/service.ts"
Cohesion: 0.17
Nodes (19): TaskSchedulerOptions, createTaskService(), TaskService, cancelTaskWithStatements(), createTaskWithStatements(), getNextPendingWithStatements(), getTaskWithStatements(), listPendingDueWithStatements() (+11 more)

### Community 1 - "index.ts"
Cohesion: 0.07
Nodes (61): ref_node_fs, ref_node_os, ref_node_path, ref_node_sqlite, vitest, buildProviderMessages(), extractClientAction(), runChat() (+53 more)

### Community 2 - "routes.ts"
Cohesion: 0.08
Nodes (44): chatBodySchema, createRoutineBodySchema, routineActionSchema, updateRoutineBodySchema, VOICE_CORE_JS_PATH, VOICE_HTML_PATH, AudiusClientOptions, headers() (+36 more)

### Community 3 - "voice.wake.test.ts"
Cohesion: 0.07
Nodes (25): DEFAULT_WAKE_PHRASES, escapeRegExp(), extractCommandAfterWake(), findWakeMatch(), matchesWakePhrase(), normalizeSpeech(), canAcceptCommand(), createVoiceMachineState() (+17 more)

### Community 4 - "youtube/tools.ts"
Cohesion: 0.11
Nodes (31): parseClientAction(), youtubeVideoIdSchema, canClaimPlaying(), enableAudioFailureReply(), EnableAudioPlan, interpretPlayAttempt(), planEnableAudioUnlock(), PLAYBACK_STATUSES (+23 more)

### Community 5 - "simulated.ts"
Cohesion: 0.10
Nodes (26): ChatResult, applyAc(), applyFan(), applyLights(), applyRgb(), assertIntegerInRange(), clamp(), KIND_BY_ID (+18 more)

### Community 6 - "app.ts"
Cohesion: 0.05
Nodes (39): allowScripts, esbuild@0.28.2, dependencies, dotenv, @google/genai, hono, @hono/node-server, openai (+31 more)

### Community 7 - "routines/service.ts"
Cohesion: 0.31
Nodes (14): ref_node_crypto, createRoutineService(), createRoutineWithStatements(), deleteRoutineWithStatements(), findRoutinesByNameWithStatements(), getRoutineWithStatements(), listRoutinesWithStatements(), RoutineRow (+6 more)

### Community 8 - "router.ts"
Cohesion: 0.07
Nodes (44): createLLMProvider(), createNamedProvider(), classifyOllamaError(), fromOllamaResponse(), OllamaChatResponse, OllamaFetch, OllamaProvider, OllamaToolCall (+36 more)

### Community 9 - "Andru"
Cohesion: 0.11
Nodes (17): Andru, Audius music (restricted), Endpoints, `GET /devices`, `GET /music/stream/:trackId`, `GET /routines`, `GET /tasks`, `GET /voice` (+9 more)

### Community 10 - "ai/tools.ts"
Cohesion: 0.16
Nodes (16): zod, powerSchema, setAcSchema, setFanSchema, setLightsSchema, setRgbSchema, cancelTaskSchema, cancelTaskTool() (+8 more)

### Community 11 - "Changelog"
Cohesion: 0.14
Nodes (13): Added, Added, Added, Behavior, Changelog, Cooldown trigger categories, Limitations, LLM Provider Cooldown + Fail-Fast (+5 more)

### Community 12 - "routines/tools.ts"
Cohesion: 0.19
Nodes (12): validateDeviceAction(), createRoutineSchema, deleteRoutineSchema, deviceActionSchema, executeRoutineTool(), listRoutinesSchema, ROUTINE_TOOL_NAMES, routineToolDefinitions (+4 more)

### Community 13 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noEmit, resolveJsonModule (+6 more)

### Community 14 - "time.ts"
Cohesion: 0.35
Nodes (11): createTaskTool(), addCalendarDays(), formatInstantForZone(), getZonedParts(), nextDaily(), nextOccurrence(), nextWeekly(), parseDueAt() (+3 more)

### Community 15 - "voice-core.js"
Cohesion: 0.27
Nodes (9): createTranscriptWakeDetector(), ensureRecognition(), processTranscript(), createVoiceMachineState(), escapeRegExp(), extractCommandAfterWake(), findWakeMatch(), normalizeSpeech() (+1 more)

### Community 16 - "TaskScheduler"
Cohesion: 0.10
Nodes (16): Andru — Project Documentation, Architecture, Architecture, LLM provider cooldown, Media, Modules, Privacy, REST (+8 more)

### Community 18 - "tasks/types.ts"
Cohesion: 0.20
Nodes (10): RoutineAction, RoutineActionResult, DEVICE_ACTION_TOOLS, DeviceActionTool, TASK_STATUSES, TASK_TYPES, TaskAction, TaskRecurrence (+2 more)

### Community 19 - "DeviceGateway"
Cohesion: 0.18
Nodes (7): Data model, executeDeviceAction(), ToolContext, AppDeps, DeviceGateway, RoutineToolContext, RoutineExecutionResult

### Community 20 - "RoutineService"
Cohesion: 0.42
Nodes (4): Service, RoutineService, resolveRoutine(), RoutineRecord

## Knowledge Gaps
- **149 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+144 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 197 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `index.ts` to `routes.ts`, `voice.wake.test.ts`, `youtube/tools.ts`, `app.ts`, `router.ts`?**
  _High betweenness centrality (0.201) - this node is a cross-community bridge._
- **Why does `LLMProvider` connect `index.ts` to `router.ts`, `routes.ts`, `DeviceGateway`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `zod` connect `ai/tools.ts` to `routes.ts`, `routines/tools.ts`, `youtube/tools.ts`, `app.ts`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _149 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06880733944954129 - nodes in this community are weakly interconnected._
- **Should `routes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07619738751814223 - nodes in this community are weakly interconnected._
- **Should `voice.wake.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06717687074829932 - nodes in this community are weakly interconnected._