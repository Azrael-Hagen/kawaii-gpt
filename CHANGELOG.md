# Changelog

## [0.3.0] - 2026-03-28
### Added
- Strategic Smart orchestration now includes the Kawaii engine as a first-class route and failover target
- Intelligent image-generation model selection by provider, with model-level fallback before provider rotation
- Auto image-model selector in Settings for generative workflows
- Voice configuration expanded with preferred voice and pitch controls for less robotic playback
- Electron media permission handlers for microphone and speaker selection on trusted app origins

### Changed
- Smart image generation now skips providers without compatible image endpoints and picks provider-specific image models automatically
- Voice playback prefers more natural installed voices when available instead of using the raw system default blindly

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
