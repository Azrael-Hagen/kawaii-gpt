# KawaiiGPT Reusable Modules

## services/aiClient.ts
Public API:
- `OllamaClient`
- `OpenAICompatibleClient`
- `LegacyEngineClient`
- `createChatClient(settings, apiKey?)`

Purpose:
- Normalizes local and online chat providers behind a single interface

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
- `speakText(text, options?)`
- `stopSpeaking()`

Purpose:
- Encapsulates STT/TTS browser APIs with a stable, testable interface

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
- `sendMessage(content)`
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
