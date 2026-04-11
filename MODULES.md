# KawaiiGPT Reusable Modules

## services/aiClient.ts
Public API:
- `OllamaClient`
- `OpenAICompatibleClient`
- `LegacyEngineClient`
- `createChatClient(settings, apiKey?)`

Purpose:
- Normalizes local and online chat providers behind a single interface

## services/errorDiagnostics.ts
Public API:
- `analyzeErrorMessage(...)`
- `createErrorLogEntry(...)`
- `appendErrorLog(...)`
- `updateErrorKnowledgeBase(...)`

Purpose:
- Captures local diagnostics, classifies failures, and learns reusable repair actions from successful recovery paths

## services/releaseLearning.ts
Public API:
- `parseReleaseKnowledge(markdown)`
- `ingestReleaseKnowledge(settings, currentVersion)`
- `summarizeReleaseKnowledge(settings, currentVersion)`

Purpose:
- Turns release notes into structured local knowledge so diagnostics can reason about what changed across app versions

## services/chatResilience.ts
Public API:
- `extractAffordableTokensFromError(message)`
- `computeQuotaRetryMaxTokens(requestedMaxTokens, errorMessage)`
- `computeSafeContextCharsFromPromptLimit(promptLimitTokens, reservedPromptChars)`
- `deriveTokenCapFromRecentErrors(logs, providerHints, now?)`

Purpose:
- Centralizes token-limit resilience so chat can auto-reduce `max_tokens` after 402/credit errors and learn per-provider token caps from recent failures

## services/localModelSelector.ts
Public API:
- `isCompatibleLocalChatModel(name)`
- `scoreLocalModelIntelligence(name)`
- `pickMostIntelligentLocalModel(models)`

Purpose:
- Selects the strongest compatible local Ollama model for smart/autoselector routes, excluding non-chat local models such as embeddings/guards/OCR variants

## services/cloudCircuitBreaker.ts
Public API:
- `getCloudProviderCircuitDecision(baseUrl, nowMs?)`
- `markCloudProviderSuccess(baseUrl)`
- `markCloudProviderFailure(baseUrl, message, nowMs?)`
- `clearCloudProviderCircuit(baseUrl)`
- `resetCloudCircuitBreaker()`

Purpose:
- Implements provider-level circuit breaker (`closed/open/half-open`) with exponential backoff + jitter and retry-after awareness, so cloud routing avoids hammering degraded providers and auto-recovers when they stabilize

## services/providerConfigTransfer.ts
Public API:
- `buildProviderConfigExportPayload(settings, secrets, runtime)`
- `parseProviderConfigImportPayload(raw)`

Purpose:
- Exports and imports provider endpoints, model selection, runtime metadata, and secret snapshots so dev and packaged profiles can be aligned without manual re-entry

## services/chatTrace.ts
Public API:
- `startChatTrace(meta)`
- `addChatTraceEvent(traceId, name, attrs?)`
- `finishChatTrace(traceId, status, attrs?)`
- `getRecentChatTraces(limit?)`
- `clearChatTraces()`
- `summarizeChatTrace(trace)`

Purpose:
- Provides non-UI trace instrumentation for chat performance and provider communication, with structured per-attempt events and compact summaries for debugging

## services/attachments.ts
Public API:
- `createMessageAttachment(file)`
- `createMessageAttachments(files)`
- `buildAttachmentContext(attachment)`
- `buildAttachmentContexts(attachments)`
- `modelSupportsVision(modelName, provider)`
- `getImageVisionAttachments(attachments, modelName, provider)`

Purpose:
- Normalizes uploaded files into persistent chat attachments and adapts them for text-context or multimodal image delivery

## utils/secureSettings.ts
Public API:
- `getProviderApiKey()`
- `setProviderApiKey(value)`

Purpose:
- Keeps provider API key outside the renderer persistence store

## services/smartRouting.ts
Public API:
- `selectRoute(settings, prompt)`
- `resolveModelForRoute(route, settings, fallback)`
- `shouldUseWebSearch(prompt)`
- `prependWebContext(messages, context)`

Purpose:
- Balances local/cloud inference and applies prompt-aware token/temperature policies

## services/webSearch.ts
Public API:
- `searchWeb(query, maxResults)`

Purpose:
- Retrieves web context snippets for fresh-info prompts in smart mode

## services/voice.ts
Public API:
- `sanitizeForSpeech(input)`
- `isSpeechRecognitionSupported()`
- `isSpeechSynthesisSupported()`
- `startSpeechRecognition(options)`
- `startAudioRecording(options)`
- `getResolvedSystemVoiceName(lang, preferredName?)`
- `speakText(text, options?)`
- `speakTextWithOpenAI(options)`
- `transcribeAudioWithOpenAI(options)`
- `stopSpeaking()`

Purpose:
- Encapsulates browser STT/TTS plus cloud transcription/TTS fallback with a stable, testable interface

## hooks/useVoiceInput.ts
Public API:
- `isListening`
- `voiceError`
- `clearVoiceError()`
- `start(onFinalText)`
- `stop()`

## hooks/useVoiceOutput.ts
Public API:
- `isSupported`
- `speak(text)`
- `stop()`
- `autoSpeakOnce(messageId, text)`

## main/index.ts (Legacy Runtime IPC)
Public API (IPC channels):
- `legacy:status`
- `legacy:start`
- `legacy:stop`

Purpose:
- Controls local KawaiiGPT runtime lifecycle from the desktop app

## services/legacyRuntime.ts
Public API:
- `ensureLegacyRuntimeReady(settings, apiKey?)`

Purpose:
- Bridges renderer-side orchestration with legacy runtime lifecycle so Smart mode can use Kawaii as a strategic engine, not only a manual provider

## store/chatStore.ts
Public API:
- `create(model, title?)`
- `remove(id)`
- `setActive(id)`
- `clear(id)`
- `rename(id, title)`
- `addMessage(convId, msg)`
- `updateMessage(convId, msgId, content, isStreaming?)`

## store/settingsStore.ts
Public API:
- `settings`
- `update(patch)`
- `reset()`

## hooks/useChat.ts
Public API:
- `sendMessage(content, attachments?)`
- `stopStreaming()`
- `isLoading`
- `error`
- `clearError()`

## hooks/useModels.ts
Public API:
- `models`
- `status`
- `loading`
- `refetch()`

Purpose:
- Resolves the active provider, checks connectivity, and loads available models

## utils/formatters.ts
Public API:
- `truncate(str, max?)`
- `titleFromMessage(content)`
- `formatTime(ms)`
- `formatRelativeDate(ms)`
- `formatModelSize(bytes)`
- `formatFileSize(bytes)`
