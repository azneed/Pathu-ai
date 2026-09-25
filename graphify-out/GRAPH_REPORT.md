# Graph Report - andru  (2026-09-25)

## Corpus Check
- 74 files · ~41,034 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 2 file(s) not represented in the graph (top: .example 1, (none) 1)

## Summary
- 613 nodes · 1619 edges · 21 communities (19 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 28 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b7d6efd2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ai/tools.ts
- index.ts
- routes.ts
- voice.wake.test.ts
- youtube/tools.ts
- simulated.ts
- package.json
- routines/service.ts
- router.ts
- Endpoints
- LLMProvider
- Changelog
- ai/types.ts
- compilerOptions
- ProviderError
- voice-core.js
- TaskScheduler
- ref_vitest_config
- createLLMProvider.ts
- openRouterProvider.ts
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
- `Data model` --references--> `executeDeviceAction()`  [INFERRED]
  docs/PROJECT_DOCUMENTATION.md → src/ai/deviceActions.ts
- `Data model` --references--> `validateDeviceAction()`  [INFERRED]
  docs/PROJECT_DOCUMENTATION.md → src/ai/deviceActions.ts

## Import Cycles
- None detected.

## Communities (21 total, 2 thin omitted)

### Community 0 - "ai/tools.ts"
Cohesion: 0.05
Nodes (69): powerSchema, setAcSchema, setFanSchema, setLightsSchema, setRgbSchema, validateDeviceAction(), cancelTaskSchema, cancelTaskTool() (+61 more)

### Community 1 - "index.ts"
Cohesion: 0.11
Nodes (44): dotenv, ref_node_fs, ref_node_os, ref_node_path, ref_node_sqlite, ref_node_url, vitest, buildProviderMessages() (+36 more)

### Community 2 - "routes.ts"
Cohesion: 0.07
Nodes (48): zod, chatBodySchema, createRoutineBodySchema, routineActionSchema, updateRoutineBodySchema, VOICE_CORE_JS_PATH, VOICE_HTML_PATH, Config (+40 more)

### Community 3 - "voice.wake.test.ts"
Cohesion: 0.07
Nodes (25): DEFAULT_WAKE_PHRASES, escapeRegExp(), extractCommandAfterWake(), findWakeMatch(), matchesWakePhrase(), normalizeSpeech(), canAcceptCommand(), createVoiceMachineState() (+17 more)

### Community 4 - "youtube/tools.ts"
Cohesion: 0.11
Nodes (31): parseClientAction(), youtubeVideoIdSchema, canClaimPlaying(), enableAudioFailureReply(), EnableAudioPlan, interpretPlayAttempt(), planEnableAudioUnlock(), PLAYBACK_STATUSES (+23 more)

### Community 5 - "simulated.ts"
Cohesion: 0.10
Nodes (27): ChatResult, applyAc(), applyFan(), applyLights(), applyRgb(), assertIntegerInRange(), clamp(), KIND_BY_ID (+19 more)

### Community 6 - "package.json"
Cohesion: 0.06
Nodes (30): allowScripts, esbuild@0.28.2, dependencies, dotenv, @google/genai, hono, @hono/node-server, openai (+22 more)

### Community 7 - "routines/service.ts"
Cohesion: 0.15
Nodes (21): ref_node_crypto, executeDeviceAction(), createRoutineService(), RoutineService, createRoutineWithStatements(), deleteRoutineWithStatements(), findRoutinesByNameWithStatements(), getRoutineWithStatements() (+13 more)

### Community 8 - "router.ts"
Cohesion: 0.16
Nodes (15): classifyCooldownReason(), CooldownReason, errorMessage(), extractErrorStatus(), isCooldownTriggerError(), ProviderCooldownRegistry, ProviderCooldownState, sanitizeForLog() (+7 more)

### Community 9 - "Endpoints"
Cohesion: 0.10
Nodes (19): Audius music (restricted), Endpoints, `GET /devices`, `GET /health`, `GET /music/stream/:trackId`, `GET /routines`, `GET /tasks`, `GET /voice` (+11 more)

### Community 10 - "LLMProvider"
Cohesion: 0.13
Nodes (13): NamedLLMProvider, LLMChatInput, LLMChatResult, LLMProvider, ScriptedProvider, CaptureProvider, ScriptedProvider, MockProvider (+5 more)

### Community 11 - "Changelog"
Cohesion: 0.12
Nodes (16): Added, Added, Added, Behavior, Changed, Changelog, Cooldown trigger categories, Limitations (+8 more)

### Community 12 - "ai/types.ts"
Cohesion: 0.19
Nodes (11): classifyGeminiError(), fromGeminiResponse(), GeminiClientLike, GeminiGenerateContent, GeminiProvider, parseToolArgs(), toGeminiRequest(), toGeminiTools() (+3 more)

### Community 13 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noEmit, resolveJsonModule (+6 more)

### Community 14 - "ProviderError"
Cohesion: 0.26
Nodes (10): classifyOllamaError(), fromOllamaResponse(), OllamaChatResponse, OllamaFetch, OllamaProvider, OllamaToolCall, parseArgs(), toOllamaMessages() (+2 more)

### Community 15 - "voice-core.js"
Cohesion: 0.27
Nodes (9): createTranscriptWakeDetector(), ensureRecognition(), processTranscript(), createVoiceMachineState(), escapeRegExp(), extractCommandAfterWake(), findWakeMatch(), normalizeSpeech() (+1 more)

### Community 16 - "TaskScheduler"
Cohesion: 0.09
Nodes (18): Architecture, Architecture, Compatibility names, Data model, Execution, Graphify, LLM provider cooldown, Media (+10 more)

### Community 18 - "createLLMProvider.ts"
Cohesion: 0.24
Nodes (8): createLLMProvider(), createNamedProvider(), OpenAIProvider, parseToolArguments(), toOpenAiMessages(), toOpenAiTools(), OpenRouterProvider, ProviderName

### Community 19 - "openRouterProvider.ts"
Cohesion: 0.24
Nodes (9): openai, fromOpenRouterMessage(), OPENROUTER_DEFAULT_BASE_URL, OPENROUTER_DEFAULT_MODEL, parseToolArguments(), toOpenAiTools(), toOpenRouterMessages(), input (+1 more)

## Knowledge Gaps
- **155 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+150 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 203 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `index.ts` to `routes.ts`, `voice.wake.test.ts`, `youtube/tools.ts`, `package.json`, `router.ts`, `LLMProvider`, `ai/types.ts`, `ProviderError`, `openRouterProvider.ts`?**
  _High betweenness centrality (0.198) - this node is a cross-community bridge._
- **Why does `LLMProvider` connect `LLMProvider` to `ai/tools.ts`, `index.ts`, `routes.ts`, `router.ts`, `ai/types.ts`, `ProviderError`, `createLLMProvider.ts`, `openRouterProvider.ts`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `zod` connect `routes.ts` to `ai/tools.ts`, `youtube/tools.ts`, `package.json`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _155 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ai/tools.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.051590483827853514 - nodes in this community are weakly interconnected._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11301369863013698 - nodes in this community are weakly interconnected._
- **Should `routes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06836055656382335 - nodes in this community are weakly interconnected._