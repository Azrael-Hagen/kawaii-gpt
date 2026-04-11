# Engineer Log

## [CP-21] 2026-04-11
**Status**: Passed
**Decisions made**:
- Added deterministic chaos tests in `services/cloudCircuitBreaker.test.ts` to validate two critical recovery paths: immediate re-open after failed half-open probe, and single in-flight half-open probe enforcement
- Kept chaos validation at service level (pure unit tests) to avoid false negatives tied to external provider credentials or network volatility
- Closed CP-21 only after full unit suite and production build succeeded on the release candidate

**Trade-offs**:
- Service-level chaos simulation gives repeatability and speed, but does not exercise full UI-driven network workflows end-to-end

**Debt deferred**:
- Add packaged-runtime chaos drills with synthetic provider stubs to validate recovery telemetry outside unit scope

**Next steps**:
- Add e2e resilience scenario that asserts route rotation timeline and breaker cooldown behavior through UI logs

## [CP-20] 2026-04-11
**Status**: Passed
**Decisions made**:
- Added provider-scoped circuit breaker in `services/cloudCircuitBreaker.ts` with `closed/open/half-open` states and full-jitter exponential backoff to reduce cascading retry storms
- Integrated circuit decisions directly into cloud queue pruning in `useChat`, and wired per-attempt success/failure reporting so recovery is automatic without waiting for manual diagnostics
- Added retry-window parsing (`retry-after`, `retry in`) to align reopen timing with provider throttle guidance when available
- Removed automatic hard blacklisting on runtime fatal errors inside cloud loop; breaker now handles temporary isolation and half-open reentry for better self-healing

**Trade-offs**:
- Circuit state is in-memory (session-scoped), which keeps behavior fast and deterministic but does not survive app restarts
- Fatal auth/quota/model errors now recover via breaker windows instead of permanent runtime lockout; this improves recovery potential but may retry again later if credentials remain invalid

**Debt deferred**:
- Persisting breaker telemetry in settings (with privacy-safe aggregation) for cross-session adaptive thresholds
- Exposing breaker state in Settings diagnostics for explicit operator visibility during incidents

**Next steps**:
- Run controlled chaos tests (forced 429/503/timeouts) in packaged mode and tune thresholds by measured p95 recovery time
- Add e2e scenario that validates half-open recovery after repeated provider failures

## [CP-17.2] 2026-04-11
**Status**: Passed
**Decisions made**:
- Added hybrid local→cloud continuation via `localPartial` capture: when local times out with ≥80 chars of response, the partial is prepended as assistant turn before cloud gets the request so cloud continues rather than restarts
- Added cloud model auto-correction in `buildCloudQueue`: checks `cloudConnectivity` for recent model-not-found signals on the resolved baseUrl, and when found, clears the preferred model hint and filters the bad model out of the pool so catalog selection picks a healthy alternative
- Added `before-quit` hook in main process to kill `legacyProcess` child; previously the spawned process would orphan when the Electron window was closed on Windows
- Fixed `SettingsModal` TS type error: `getRuntimeMode()` result now cast to the expected union literal type

**Trade-offs**:
- Hybrid continuation injects two extra messages into the effective context for cloud; in extreme context-budget situations these messages could slightly reduce available history, but the benefit of seamless continuation outweighs this on typical payloads
- Model auto-correction uses a 10-minute validity window on connectivity data; if the model is restored after 10 minutes this guard will stop firing (safe behavior)

**Debt deferred**:
- The `reka/reka-edge` model remains in `settings.cloudModel`; a UX flow to auto-suggest updating the persisted cloudModel when the connectivity guard fires repeatedly would improve the long-term experience

**Next steps**:
- Run real user session with intentional cloud trigger to confirm `reka/reka-edge` is consistently bypassed and `gpt-5.4-nano` (or catalog equivalent) takes over

## [CP-17.1] 2026-04-11
**Status**: Passed
**Decisions made**:
- Switched per-provider streaming timeouts from fixed-wall-clock to progress-aware idle timers so long active generations are not aborted mid-response
- Added a compact local retry path before cloud fallback when learned timeout history indicates `reduce_load_or_retry`

**Trade-offs**:
- A stalled stream can now stay alive longer if it keeps dribbling tiny chunks, but that is preferable to cutting off legitimate long answers mid-flight

**Debt deferred**:
- Cloud fallback still starts after one local recovery attempt; a richer multi-step continuation strategy could later merge partial local text with cloud continuation more elegantly

**Next steps**:
- Observe real user sessions for any remaining timeout cases and tune idle timeout thresholds only with trace evidence

## [CP-17] 2026-04-11
**Status**: Passed
**Decisions made**:
- Tightened prompt-limit budgeting to reserve room for both the visible user turn and the effective system prompt before trimming history
- Added prompt-limit specific learning so autorecovery can recognize `compact_context` as a distinct repair strategy instead of lumping it into generic quota handling
- Protected generated parity artifacts and provider-export snapshots from accidental git inclusion

**Trade-offs**:
- Context trimming is now more conservative on small-window cloud providers, which may shorten recalled history sooner in exchange for higher delivery reliability

**Debt deferred**:
- Same-request cloud retry after a provider returns a prompt-limit error can still be added later for even more autonomous recovery
- A dedicated runtime-profile diff script could make dev vs packaged audits faster than manual snapshot comparison

**Next steps**:
- Validate the same provider profile in dev and packaged after import/export to confirm parity under the user workflow
- Observe new traces for real prompt-limit events and tune budgets further only if evidence still shows overflow

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

## [CP-11.2] 2026-03-28
**Status**: Passed
**Decisions made**:
- Added automatic TTS strategy that prefers OpenAI `gpt-4o-mini-tts` when a compatible official provider is configured, with fallback to the best installed system voice
- Prepared package metadata and build publish config for GitHub releases under `Azrael-Hagen/kawaii-gpt`

**Trade-offs**:
- Cloud-quality voice now depends on an official OpenAI-compatible endpoint with support for `/audio/speech`; otherwise the app falls back locally
- System voice fallback remains host-dependent, but now sits behind a better selection strategy instead of a blind default

**Debt deferred**:
- Add optional cloud STT/transcription fallback for environments where browser speech recognition is unstable
- Add release automation workflow for publishing installer artifacts directly from CI

**Next steps**:
- Add a release pipeline that publishes tagged builds to GitHub Releases automatically
- Surface which voice engine was chosen for each playback in diagnostics

## [CP-11.3] 2026-03-28
**Status**: Passed
**Decisions made**:
- Split manual TTS availability from automatic playback so opening the app never reads historical assistant messages by surprise
- Added voice input mode selection (`auto` / `browser` / `cloud`) and a cloud transcription fallback using `/audio/transcriptions` for OpenAI-compatible endpoints

**Trade-offs**:
- Cloud dictation uses push-to-talk style recording, so it is slightly less immediate than browser dictation but more reliable when Web Speech fails
- Automatic cloud fallback currently targets official OpenAI-compatible endpoints only, matching the already-supported TTS strategy

**Debt deferred**:
- Add streaming transcription for long-form dictation instead of stop-and-transcribe
- Surface the active dictation engine in the chat UI while listening

**Next steps**:
- Add integration coverage for browser-error to cloud-fallback transition
- Surface a small microphone-mode badge in the chat input when cloud dictation is active

## [CP-12.1] 2026-03-29
**Status**: Passed
**Decisions made**:

**Trade-offs**:

**Debt deferred**:

**Next steps**:

## [CP-18] 2026-04-03
**Status**: Passed
**Decisions made**:
- Extracted token-limit handling into `services/chatResilience.ts` to decouple resilience logic from `useChat` orchestration
- Added provider-aware learned token cap from recent 402/credit errors to reduce repeat failures in consecutive messages
- Added automatic same-provider retry with reduced `max_tokens` before rotating provider when quota/token cap is detected

**Trade-offs**:
- Automatic retry prioritizes delivery continuity over preserving the originally requested output length
- Token cap learning uses recent error heuristics and provider text matching, which is robust in practice but still string-based

**Debt deferred**:
- Add explicit provider health contracts in E2E tests (with mocked provider responses) for full route-level regression protection
- Consider persisting provider token caps as structured state instead of inferring from error logs

**Next steps**:
- Add an integration test that simulates 402 then successful retry with reduced tokens
- Surface current effective token cap per provider in diagnostics UI for transparency

## [CP-13.1] 2026-03-28
**Status**: Passed
**Decisions made**:
- Added throttled partial updates for streamed assistant output to avoid full React tree work on every token chunk
- Switched streaming assistant rendering to plain text until completion, deferring markdown parsing to finalized responses
- Disabled smooth animation during active streaming autoscroll to cut layout/paint overhead

**Trade-offs**:
- Streaming text may appear slightly less granular than token-by-token paint, but remains responsive and substantially smoother
- Conversation ordering metadata is now updated at message completion, not per partial token

**Debt deferred**:
- Add lightweight runtime telemetry (FPS/frame budget and update frequency) for objective before/after measurements in-app
- Evaluate virtualization for very long chat histories to control render cost at >1k messages

**Next steps**:
- Add a user-facing toggle for "stream update frequency" in advanced settings
- Profile markdown render cost by message size and consider incremental markdown rendering strategy

## [CP-14.1] 2026-03-29
**Status**: Passed
**Decisions made**:
- Extended `CharacterProfile` with persisted visual identity fields (textual style + optional reference image metadata/data)
- Added profile-image upload/preview/remove flow in Settings to keep persona authoring inside the existing character workspace
- Enriched image-generation prompts with character visual guidance and optional multimodal trait extraction from the profile image

**Trade-offs**:
- Storing a data URL keeps implementation simple and portable, but can increase persisted settings size for large images
- Multimodal visual extraction improves consistency when available, but still depends on provider/model capabilities

**Debt deferred**:
- Add image-size validation/compression pipeline before persistence to avoid oversized settings payloads
- Add deterministic seed/style controls in UI for even stronger visual continuity across generated outputs

**Next steps**:
- Add import/export for full character presets including visual profile image
- Add provider-level diagnostics showing when multimodal trait extraction was used vs skipped

## [CP-15.1] 2026-03-29
**Status**: Passed
**Decisions made**:
- Removed per-message cloud connectivity preflight checks and moved to direct execution with existing provider-rotation fallback on real failures
- Kept character visual context injection but limited image attachment payload to early turn usage to avoid repeated heavy multimodal input
- Preserved immediate character embodiment behavior through text identity context + system prompt reinforcement

**Trade-offs**:
- Skipping proactive health checks can surface provider errors at execution time, but significantly reduces startup latency for normal requests
- Limiting repeated image attachments improves responsiveness but relies more on textual visual guide continuity after initial grounding

**Debt deferred**:
- Add optional cached provider health TTL instead of per-message checks to blend speed and proactive reliability
- Add lightweight telemetry for time-to-first-token and provider failover frequency in-app

**Next steps**:
- Expose advanced toggle for cloud precheck policy (off/ttl/on-demand) in Settings
- Add performance diagnostics panel with p50/p95 response startup metrics by route

## [CP-16.1] 2026-03-30
**Status**: Passed
**Decisions made**:
- Added a local automatic error logger backed by persisted settings so diagnostics survive app restarts without needing external infrastructure
- Implemented a lightweight heuristic "mini AI" for error analysis instead of invoking another model during failure conditions
- Expanded user memory extraction to include secondary preference/personality signals that are useful for personalization without leaving the current conversation scope

**Trade-offs**:
- Heuristic error analysis is less expressive than a full LLM debugger, but it is deterministic, fast, and still works when the network/provider is failing
- Persisting logs in settings is simple and local-first, but it is not a full observability pipeline with aggregation or remote telemetry

**Debt deferred**:
- Add export-to-file for error logs and one-click GitHub issue template generation
- Add TTL/retention controls for low-priority memory facts and diagnostic logs

**Next steps**:
- Add selective redaction before copying reports if future logs include richer request metadata
- Add per-provider counters and mini dashboard for recurring failure patterns

## [CP-17.1] 2026-03-30
**Status**: Passed
**Decisions made**:
- Extended the local diagnostics engine with case-based learned repairs so recurrent failures can reuse proven fallback actions without invoking another model
- Parsed `CHANGELOG.md` into structured release knowledge and ingested it on startup to connect current failures with newly added, changed, or fixed behavior
- Surfaced learned error cases and version knowledge in Settings so the adaptive behavior remains inspectable instead of hidden

**Trade-offs**:
- Learned repair confidence is intentionally conservative, so some recoverable cases will still use the default fallback path until enough successful history exists
- Release-awareness is limited by changelog quality; if a change is undocumented, the local learner cannot infer it from version metadata alone

**Debt deferred**:
- Add decay/retention rules so stale learned cases lose priority when providers or routes change significantly over time
- Correlate learned cases with explicit latency and provider reliability metrics instead of success counters alone

**Next steps**:
- Add a compact explanation badge in chat when a learned fallback was selected automatically
- Add import/export support for learned diagnostics knowledge if local portability becomes necessary

## [CP-17.2] 2026-03-31
**Status**: Passed
**Decisions made**:
- Completed modular split of App UI vs orchestration logic via `useAppLogic` to reduce blast radius of future changes
- Fixed runtime crash in chat hook caused by evaluating diagnostics flags before store initialization (`settings` TDZ)
- Restored Smart routing compatibility for creative prompts with optional legacy engine, guarded by recent-failure avoidance
- Improved diagnostics learning merge logic to reuse known fixes across providers when fingerprint/action match

**Trade-offs**:
- Kept diagnostics improvements heuristic-first to avoid introducing external dependencies and preserve deterministic behavior
- Retained existing architecture and public APIs to avoid regressions in validated flows

**Debt deferred**:
- Add source-mapped error telemetry for renderer runtime exceptions to shorten future root-cause time
- Add E2E scenarios for legacy smart-route selection under simulated provider outages

**Next steps**:
- Add a focused E2E that validates at least one full send/response chat roundtrip in mock mode
- Add lint gate for `no-use-before-define` in hooks to prevent TDZ regressions

## [CP-19] 2026-04-04
**Status**: Passed
**Decisions made**:
- Added a dedicated non-UI chat tracing module (`chatTrace`) with structured events and bounded retention to debug route/provider failures with timing context
- Instrumented `useChat` at communication-critical boundaries (route decision, context trim, local/legacy/cloud attempts, quota retry, timeout) instead of relying on coarse text logs
- Removed diagnostic knowledge panels that were not providing actionable runtime recovery value

**Trade-offs**:
- Trace data remains local and in-memory for low overhead; it is not a full external telemetry pipeline
- Knowledge models are still retained in settings for compatibility, but no longer shown as primary diagnostics UX

**Debt deferred**:
- Add optional trace export-to-file for postmortem sharing
- Add E2E scenario that asserts trace event sequence under forced provider failures

**Next steps**:
- Add a tiny scriptable command in diagnostics to snapshot traces plus latest error logs in one artifact
- Track p50/p95 first-token latency from trace events for release gating
