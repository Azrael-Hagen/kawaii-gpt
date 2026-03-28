# Engineer Log

## [CP-01] 2026-03-25
**Status**: Passed
**Decisions made**:
- Chose Electron over Tauri due to missing Rust toolchain in environment
- Used React + TypeScript + Tailwind for rapid, maintainable UI development

**Trade-offs**:
- Electron has larger bundle size than Tauri, but faster setup and simpler dependency model in this environment

**Debt deferred**:
- Installer icons not yet added (`resources/icon.*`)

**Next steps**:
- Complete CP-05 hardening with security and performance validation

## [CP-02] 2026-03-25
**Status**: Passed
**Decisions made**:
- Isolated all AI transport in `services/ollamaClient.ts`
- Kept stores framework-agnostic and side-effect free (except persistence)

**Trade-offs**:
- Direct fetch integration avoids extra SDK dependency complexity

**Debt deferred**:
- Retry/backoff policy can be centralized in a request helper

**Next steps**:
- Expand test coverage to error and cancellation paths

## [CP-03] 2026-03-25
**Status**: Passed
**Decisions made**:
- Prioritized intuitive UX: clear model selector, status indicator, and settings modal
- Implemented markdown rendering for assistant output quality

**Trade-offs**:
- Kept component set small to simplify first release

**Debt deferred**:
- Accessibility pass (ARIA and keyboard shortcuts) can be expanded

**Next steps**:
- Add E2E coverage for core chat journey

## [CP-04] 2026-03-25
**Status**: Passed
**Decisions made**:
- Streaming implemented with async generator for smooth token updates
- Non-stream fallback retained for robustness
- Added provider abstraction for local Ollama and online OpenAI-compatible APIs
- Moved API key storage out of renderer persistence into Electron-side store

**Trade-offs**:
- Minimal provider abstraction now; can expand later with per-provider presets and telemetry

**Debt deferred**:
- Auto-failover between local and cloud providers has not been implemented yet

**Next steps**:
- Run release hardening gate with real Ollama runtime and a real provider key

## [CP-05] 2026-03-25
**Status**: Blocked
**Decisions made**:
- Added hybrid provider support so Kawaii can offload inference to online providers and keep a local Ollama fallback
- Installed Ollama locally via winget and provisioned `qwen2.5:0.5b` as a lightweight fallback model

**Trade-offs**:
- Online provider path requires a user-supplied API key, so end-to-end cloud validation cannot be completed automatically without credentials

**Debt deferred**:
- Automatic provider failover from cloud to local has not been implemented yet
- Cold-start timing for the Electron window still needs a dedicated runtime benchmark

**Next steps**:
- Enter an online provider API key in Settings to validate the cloud path
- Measure real Electron cold start and promote CP-05 to passed when it is under budget

## [CP-06.1] 2026-03-25
**Status**: Passed
**Decisions made**:
- Added a reusable cloud model catalog service with provider detection and fast/strong model selection heuristic
- Enabled Smart mode to hide manual model chooser in the main chat input and route automatically
- Appended curated cloud models (including GPT family) even when providers return partial/empty model lists
- Footer app version now reads from Electron `app.getVersion()` and project version was bumped to `0.2.0`

**Trade-offs**:
- Heuristic routing is deterministic and lightweight, but not yet telemetry-driven

**Debt deferred**:
- Add latency/quality telemetry to evolve from heuristic scoring to measured ranking
- Add integration tests for multi-provider fallback with mocked quota and model-not-found scenarios

**Next steps**:
- Validate cloud path live with at least one OpenRouter/OpenAI API key in Smart mode
- Add per-provider preferred model override in settings for advanced users

## [CP-06.2] 2026-03-25
**Status**: Passed
**Decisions made**:
- Added explicit smart-routing settings for unrestricted-priority and free-tier-priority
- Added one-click recommended profile for existing users outside onboarding wizard
- Extended model scoring to prefer less-restricted families when unrestricted priority is enabled

**Trade-offs**:
- "Less-restricted" preference is heuristic by model family naming, not a formal provider policy guarantee

**Debt deferred**:
- Add runtime quality telemetry to demote models that output corrupted/repetitive text automatically

**Next steps**:
- Add optional "strict cloud-first" smart mode toggle for users with reliable API quotas

## [CP-07.1] 2026-03-25
**Status**: Passed
**Decisions made**:
- Introduced `legacy-engine` as a feature-flagged provider to avoid regressions in existing local/cloud/smart flows
- Isolated integration in `LegacyEngineClient` (adapter pattern) with health and models probing (`/health` then `/models`)
- Added settings-level enable switch so legacy remains opt-in for canary rollout

**Trade-offs**:
- Phase 1 assumes OpenAI-compatible bridge endpoints for chat streaming (`/chat/completions`)
- Image generation is intentionally disabled for legacy route until endpoint compatibility is verified

**Debt deferred**:
- Add a dedicated Electron-main managed Python bridge process for the upstream repository runtime
- Add E2E tests with real local legacy process lifecycle (start/stop/retry)

**Next steps**:
- Build Phase 2 IPC bridge in main process to run Python engine safely and expose a hardened local API
- Add per-provider telemetry (latency/error rate) to compare legacy against current smart stack

## [CP-08.1] 2026-03-25
**Status**: Passed
**Decisions made**:
- Implemented voice input/output using native Web APIs (`SpeechRecognition`/`speechSynthesis`) to avoid extra heavy dependencies
- Kept all voice behavior optional and controlled via persisted settings toggles
- Added adapter-style hooks (`useVoiceInput`, `useVoiceOutput`) so UI components stay thin

**Trade-offs**:
- Speech recognition support depends on runtime/browser engine capabilities
- Voice input currently uses single-shot dictation (`continuous = false`) for predictable UX and lower error surface

**Debt deferred**:
- Add cloud STT fallback (audio upload via MediaRecorder) for runtimes without speech recognition
- Add explicit microphone permission handling policy in main process for stricter security posture

**Next steps**:
- Add push-to-talk keyboard shortcut and waveform indicator
- Extend E2E coverage for voice-enabled user journey

## [CP-09.1] 2026-03-25
**Status**: Passed
**Decisions made**:
- Added legacy runtime lifecycle management in Electron main process via IPC (`status/start/stop`)
- Kept execution configurable from Settings (command/args/cwd) to support different local KawaiiGPT setups
- Preserved adapter-based architecture so existing local/cloud/smart paths remain unchanged

**Trade-offs**:
- Runtime process manager currently uses shell execution for flexibility; this increases need for trusted local configuration
- Argument parser is intentionally simple (space-split) for MVP operation

**Debt deferred**:
- Add strict sender validation and explicit command allowlist for legacy runtime IPC hardening
- Add structured args editor (array UI) to avoid shell quoting edge-cases

**Next steps**:
- Add one-click preset for typical KawaiiGPT runtime launch commands per OS
- Add integration test that mocks runtime start/stop and verifies status transitions

## [CP-10.1] 2026-03-27
**Status**: Passed
**Decisions made**:
- Integrated Kawaii legacy into Smart routing as a first-class target for long/creative prompts
- Added renderer-side runtime readiness helper so manual legacy and Smart failover can auto-start the local engine when needed
- Extended cloud failover order to try Kawaii before dropping to local Ollama when legacy is enabled

**Trade-offs**:
- Strategic selection is still heuristic-based; it uses prompt shape rather than measured latency/quality telemetry
- Auto-start only applies to localhost legacy endpoints to avoid unsafe behavior against remote URLs

**Debt deferred**:
- Add latency/error telemetry to let Smart rank local, cloud, and Kawaii from real usage instead of heuristics
- Add integration tests that mock legacy warm-up delays and startup failures

**Next steps**:
- Surface a compact Smart strategy summary in the UI showing why each engine was chosen
- Add a one-click validation flow that tests local, cloud, and Kawaii together from Settings

## [CP-11.1] 2026-03-28
**Status**: Passed
**Decisions made**:
- Added provider-aware image model selection so Smart can pick compatible generative models instead of reusing chat defaults
- Added explicit voice selection and pitch controls, while keeping output fully optional for users who do not want TTS
- Added trusted-origin Electron media permission handling and renderer-side microphone permission requests before dictation

**Trade-offs**:
- TTS naturalness still depends on the voices installed on the host OS; the app can choose better voices, but cannot synthesize a ChatGPT-grade voice without an external TTS provider
- Microphone permissions are now handled correctly, but speech recognition quality still depends on Chromium Web Speech support in the runtime

**Debt deferred**:
- Add cloud TTS provider integration for higher-quality voices
- Add a true STT fallback path that does not depend on the browser speech-recognition engine

**Next steps**:
- Expose a Smart diagnostics summary showing which image model and voice were auto-selected
- Add integration tests for microphone permission-denied and image-model-not-found cases
