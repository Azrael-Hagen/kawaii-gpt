# Changelog

## [0.4.2] - 2026-03-29
### Added
- Perfil de personaje ahora admite imagen de referencia persistida desde Settings para construir identidad visual consistente
- Nuevo campo de identidad visual textual para complementar la referencia de imagen cuando se generan prompts de imagen

### Changed
- La composicion de prompts para generacion de imagen incorpora automaticamente rasgos visuales del personaje cuando el perfil esta activo
- El flujo de generacion puede resumir la imagen de perfil con una pasada multimodal para reforzar consistencia estetica

### Fixed
- Se reduce la variacion visual entre generaciones al reutilizar una guia estable de apariencia del personaje

## [0.4.1] - 2026-03-28
### Changed
- Streaming de respuestas ahora actualiza la UI con throttling en lugar de forzar re-render por cada token
- El render de burbujas en mensajes de assistant en curso usa texto plano durante streaming y aplica markdown completo al finalizar
- El autoscroll usa comportamiento instantaneo durante streaming para reducir costo de animacion continuo

### Fixed
- Menor sensacion de congelamiento mientras la IA responde en conversaciones largas o con alta frecuencia de tokens
- Se evita actualizar `updatedAt` de la conversacion en cada parcial de streaming, reduciendo churn de estado en la barra lateral

## [0.4.0] - 2026-03-29
### Added
- File attachments in chat with local text extraction, inline previews, and persisted metadata in conversation history
- Vision-aware payload shaping so compatible cloud and Ollama models can inspect attached images directly
- Structured character builder in Settings for persistent persona, attitude, speaking style, and scenario control
- Voice diagnostics in Settings showing the actual engine and voice resolved during the latest playback

### Changed
- Effective system prompt now composes unrestricted core instructions, optional character profile, and user system prompt together
- Chat input can send attachment-only turns and names the conversation from the first attached file when needed
- TTS observability now records the requested voice and the voice that was really used

### Fixed
- Reduced ambiguity around whether the selected voice was actually respected during playback
- Preserved provider compatibility by sending extracted text for generic files and true multimodal image data only to likely vision-capable targets

## [0.3.0] - 2026-03-28
### Added
- Strategic Smart orchestration now includes the Kawaii engine as a first-class route and failover target
- Intelligent image-generation model selection by provider, with model-level fallback before provider rotation
- Auto image-model selector in Settings for generative workflows
- Voice configuration expanded with preferred voice and pitch controls for less robotic playback
- Electron media permission handlers for microphone and speaker selection on trusted app origins
- Automatic voice output strategy that prefers OpenAI TTS when available and falls back to the best local system voice
- GitHub repository/release metadata in package build config for executable publishing

### Changed
- Smart image generation now skips providers without compatible image endpoints and picks provider-specific image models automatically
- Voice playback prefers more natural installed voices when available instead of using the raw system default blindly
- Executable artifact naming and publish target are aligned with the GitHub repository configuration

### Fixed
- Reduced 404/resource-not-found errors caused by incompatible image models on providers like Together
- Improved microphone startup path by requesting audio permission before dictation begins

## [0.2.3] - 2026-03-25
### Added
- Legacy runtime lifecycle control from app settings (start/stop/status)
- IPC bridge for legacy process management (`legacyStatus`, `legacyStart`, `legacyStop`)
- Persisted runtime launch configuration (`legacyRuntimeCommand`, `legacyRuntimeArgs`, `legacyRuntimeCwd`)

### Changed
- Legacy adapter integration upgraded from URL-only mode to app-managed runtime mode

### Fixed
- Reduced manual operational steps to run KawaiiGPT legacy engine alongside existing app features

## [0.2.2] - 2026-03-25
### Added
- Voice chat MVP with microphone dictation in the chat input
- Optional auto-send after dictation completion
- Optional text-to-speech for assistant responses (manual button + automatic playback)
- Voice settings in modal: input/output toggles, auto-send, language, and speech rate
- New reusable voice modules (`services/voice.ts`, `hooks/useVoiceInput.ts`, `hooks/useVoiceOutput.ts`)

### Changed
- Settings persistence schema upgraded to include voice configuration fields

### Fixed
- Voice-unavailable runtimes now fail gracefully and keep normal text chat unaffected

## [0.2.1] - 2026-03-25
### Added
- Legacy engine adapter foundation (`legacy-engine`) with feature flag (`enableLegacyEngine`) off by default
- Legacy provider support in model discovery and chat streaming flow
- Settings controls to enable legacy adapter and configure legacy base URL

### Changed
- Settings persistence schema upgraded to include legacy provider fields (`legacyEngineBaseUrl`, `legacyModel`, `enableLegacyEngine`)

### Fixed
- Preserved backward compatibility of existing Ollama, cloud, and smart routes while introducing legacy integration path

## [0.2.0] - 2026-03-25
### Added
- Cloud catalog service with known provider detection and curated model families
- GPT family cloud presets (including ChatGPT/GPT variants) for OpenAI/OpenRouter endpoints
- Smart model auto-selection heuristic (fast vs strong) based on prompt complexity
- Smart chat input mode that auto-routes without requiring manual model selection
- Dynamic app version in sidebar footer via Electron `app.getVersion()`
- One-click recommended profile in Settings (gratis + smart + rotacion)
- Smart routing toggles for unrestricted-priority and free-tier-priority

### Changed
- Expanded additional provider capacity to 3 slots
- Improved cloud queue construction to skip providers with empty API keys and choose provider-specific models

### Fixed
- Reduced invalid cross-provider model fallback issues in auto-rotation

## [0.1.0] - 2026-03-25
### Added
- Initial Electron + React + TypeScript desktop app scaffold
- Kawaii modern UI theme with custom title bar
- Ollama integration (model list + chat + streaming)
- Conversation sidebar and settings modal
- Zustand persisted chat and settings stores
- Unit tests for formatters, chat store, and Ollama client
- Project governance docs: CHECKPOINTS.md, MODULES.md, VERSIONING.md
