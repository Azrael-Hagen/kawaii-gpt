# Changelog

## [0.6.0] - 2026-04-13
### Added
- Recovery reinforcement for image generation success when provider rotated (idx > 0)
- Recovery reinforcement for web search repair success (when web context denial is recovered via re-generation)
- Extended autorecovery learning to cover complete feature lifecycle (chat, image, web search)

### Changed
- Confidence scoring for recovery actions now includes successful image generation and web-grounded response repairs
- Knowledge base accumulates bidirectional feedback: both failure patterns AND successful automatic recoveries

### Technical
- Image generation fallback now calls `reinforceRecovery()` when alternate provider completes successfully
- Web search repair flow now reinforces recovery knowledge when web-denied response is successfully rewritten

## [0.5.0] - 2026-04-13
### Changed
- Dedicated major upgrade phase applied to close residual toolchain risk without mixing functional feature changes
- Upgraded build/test stack to `electron-vite@5.0.0`, `vite@7.3.2`, `vitest@4.1.4`, and `@vitejs/plugin-react@5.2.0`

### Fixed
- Eliminated all previously deferred moderate advisories tied to Vite/esbuild and test/build toolchain (`npm audit` now reports zero vulnerabilities)
- Preserved end-to-end runtime behavior after upgrade (unit tests, production build, and E2E critical chat/UI flow all passing)

## [0.4.32] - 2026-04-13
### Added
- Smart routing regression test to enforce cloud cooldown fallback even when `localModel` is empty and resolved automatically
- Abort-signal coverage test for image generation requests in `aiClient`

### Changed
- Image generation requests now accept and propagate `AbortSignal`, so global timeout and manual stop can cancel stuck image calls
- Cloud and legacy fallback paths now enforce per-attempt local timeouts (including streaming fallback branches), reducing hangs and retry cascades on degraded runtimes
- Updated Electron to `^41.2.0` and refreshed lockfile security patches via `npm audit fix`

### Fixed
- Prevented image generation attempts from ignoring cancellation/timeout controls
- Removed several dependency vulnerabilities (`npm audit --audit-level=high` now reports zero HIGH/CRITICAL findings; remaining advisories are moderate and tied to major-toolchain upgrades)

## [0.4.31] - 2026-04-11
### Added
- New configurable local capacity filter mode in Settings with `Auto`, `Conservador`, `Agresivo`, and `Desactivado` options
- Hardware profile bridge from Electron main/preload so renderer decisions use the current PC RAM/CPU profile safely

### Changed
- Local model filtering now uses the selected hardware profile mode instead of a fixed threshold
- Persisted local model selections are auto-corrected to the strongest still-valid local candidate when a stricter capacity mode removes the previous choice

## [0.4.30] - 2026-04-11
### Added
- New local model intelligence selector (`services/localModelSelector.ts`) that filters non-chat local models (embeddings/guard/ocr) and ranks compatible models by capability
- Unit tests for local selector behavior (`services/localModelSelector.test.ts`)

### Changed
- Smart/autoselector local routing now prefers the most intelligent compatible Ollama model instead of the first discovered model
- Local model bootstrap in `useModels` now auto-populates `localModel` with the strongest compatible local model for smart mode

## [0.4.29] - 2026-04-11
### Added
- Chaos validation scenarios for cloud circuit breaker (`services/cloudCircuitBreaker.test.ts`) covering: half-open probe failure re-open, fatal-first-failure open, and single in-flight half-open probe guard

### Changed
- Release gate now requires deterministic chaos coverage for cloud autorecovery before version promotion (CP-21)

## [0.4.28] - 2026-04-11
### Added
- New cloud provider circuit breaker module (`services/cloudCircuitBreaker.ts`) with `closed/open/half-open` state machine and provider-scoped failure memory
- Exponential backoff with jitter plus `retry-after` parsing to align recovery windows with provider throttling signals
- Unit test suite for breaker behavior (`services/cloudCircuitBreaker.test.ts`) covering open, half-open, close, and retry window handling

### Changed
- Cloud queue pruning now respects circuit state before attempting provider calls, reducing repeated failures against degraded endpoints
- Chat runtime now marks cloud provider success/failure per attempt so autorecovery decisions are fed by real execution outcomes
- Fatal provider errors no longer force immediate hard session-blacklisting in the chat loop; breaker-based temporary isolation is used for better self-healing

## [0.4.27] - 2026-04-11
### Fixed
- Messages with stale `isStreaming: true` (ghosts from crashed sessions) are now filtered out when building the API context in `sendMessage` — previously they caused empty `assistant: ""` turns that most providers reject with 400/422
- Empty assistant placeholder messages (content = "") at the tail of a conversation no longer reach the API
- Consecutive duplicate user messages (from retry double-sends) are deduplicated before the API call
- Store rehydration now clears all residual `isStreaming: true` flags and removes empty assistant tail-ghosts on app start so the UI no longer shows stuck loading spinners from past crashes
- Imported conversations (`conversationTransfer`) now always land with `isStreaming: false` and without empty assistant tail messages

## [0.4.26] - 2026-04-11
### Added
- Hybrid local→cloud continuation: when local times out mid-response with substantial partial content (≥80 chars), the partial is injected as an assistant turn + "Continúa desde donde quedaste" instruction so cloud resumes seamlessly rather than restarting
- Cloud model auto-correction: `buildCloudQueue` now detects invalid configured models via recent `cloudConnectivity` data (model-not-found detail) and falls back to catalog selection when the preferred model is known bad
- Process cleanup on quit: `legacyProcess` child is now killed via a `before-quit` hook so closing the window never leaves zombie processes behind

### Fixed
- `SettingsModal` type error: `getRuntimeMode()` return value now correctly cast to `'dev' | 'packaged' | 'unknown'` union type
- Cloud fallback no longer retries with `reka/reka-edge` (or any other recently-confirmed invalid model) when `cloudConnectivity` signals model-not-found for the resolved baseUrl

## [0.4.25] - 2026-04-11
### Changed
- Provider attempt timeouts are now progress-aware during streaming, so active responses no longer expire just because the total generation lasts longer than the original timeout window
- Smart local recovery now retries once with compacted context before escalating to cloud when the learned action suggests `reduce_load_or_retry`

### Fixed
- Resolved recurrent visible `Timeout local tras ...` failures on follow-up turns where Ollama was still streaming useful output
- Prevented premature fallback escalation on long-but-active local responses by resetting per-attempt timeout on each chunk

## [0.4.24] - 2026-04-11
### Added
- Provider configuration transfer tests covering export/import normalization and runtime metadata preservation
- Git ignore rules for generated runtime/profile backups so parity artifacts do not leak into commits by accident

### Changed
- Prompt-limit context budgeting now reserves space for the full user prompt plus system prompt and uses a more conservative chars-per-token heuristic
- Smart/local->cloud fallback recomputes effective context size after cloud re-trimming so timeout/token heuristics use the real compacted payload
- Error diagnostics now distinguish prompt-window overflows from generic quota errors and learn `compact_context` as a reusable repair action

### Fixed
- Reduced recurrent `Prompt tokens limit exceeded` failures on OpenRouter-like providers when long persona/system prompts were present
- Prevented prompt-limit learning from underestimating payload size by excluding the system prompt from reserved-budget math

## [0.4.23] - 2026-04-04
### Added
- New token resilience module (`chatResilience`) to centralize parsing of provider affordability errors and adaptive token-cap derivation from recent failures
- Unit tests dedicated to token affordability parsing and cap computation to protect upgrade-time behavior

### Changed
- Smart/cloud orchestration now learns per-provider token caps from recent error logs and applies safer `max_tokens` values before request dispatch
- On quota/credit affordability failures, the chat flow retries once on the same provider with a reduced token budget before rotating providers
- Message bubbles now show long date-time format for clearer conversation timeline context

### Fixed
- Resolved recurring OpenRouter affordability regression where responses failed with errors like `requested up to N` and `can only afford M`
- Improved chat fluidity under long conversations by reducing render and stream-update pressure during assistant streaming

## [0.4.6] - 2026-03-30
### Added
- Timeouts robustos para operaciones de chat y streaming en clientes Ollama/OpenAI-compatible/Legacy para evitar esperas indefinidas
- Timeout de seguridad para busqueda web por IPC, evitando que el chat se bloquee cuando el proveedor web no responde
- Deteccion de conflictos recientes por runtime local (errores de memoria) y por motor Kawaii (timeouts/fetch fallidos) para ajustar el ruteo Smart

### Changed
- Smart ahora evita enrutar a local cuando hay fallos recientes de memoria en Ollama y prioriza cloud cuando hay disponibilidad
- Smart evita seleccionar Kawaii cuando detecta conflictos repetidos recientes, y puede desactivarlo temporalmente para estabilizar el chat
- El flujo de fallback ahora respeta los motores marcados como inestables y muestra mensaje accionable en lugar de entrar en bucles de reintento

### Fixed
- Se corrige bloqueo del chat cuando la inicializacion del motor Kawaii falla en ramas de ruteo legacy/smart
- Se reduce significativamente la incidencia de estados colgados por streams abiertos sin cierre ni error explicito del proveedor

## [0.4.5] - 2026-03-30
### Added
- Aprendizaje local de casos de error exitosos con huellas, acciones recomendadas y nivel de confianza reutilizable
- Ingestion del changelog como conocimiento de versiones para que la app aprenda que se agrego, cambio o corrigio en cada release
- Nueva vista en Opciones para consultar conocimiento aprendido de errores y resumen de versiones recientes

### Changed
- La ruta de chat ahora puede priorizar automaticamente un fallback aprendido cuando la confianza historica del caso es suficientemente alta
- El arranque de la app incorpora conocimiento de releases nuevos al almacen local para ampliar el rango de diagnostico y auto-reparacion

### Fixed
- Reduce reintentos ciegos ante errores recurrentes al reutilizar reparaciones que ya funcionaron en el mismo contexto
- Mejora la continuidad del diagnostico local al vincular errores actuales con cambios confirmados en versiones recientes

## [0.4.4] - 2026-03-30
### Added
- Logger automatico local de errores con captura global de renderer y fallos de chat
- Asistente de errores heuristico que clasifica causas, detecta reparacion automatica y genera reporte listo para copiar cuando no puede resolver
- Seccion de diagnosticos en Opciones para ver logs recientes, activar/desactivar asistencia y consultar el ultimo reporte automatico
- Memoria secundaria del usuario ampliada con gustos, hobbies, rasgos de personalidad y estilo de comunicacion

### Changed
- Los errores de chat ahora se registran localmente junto con proveedor, ruta y estado de auto-reparacion
- Los fallbacks exitosos a legacy o local quedan marcados como auto-reparados en el diagnostico

### Fixed
- Mejora la trazabilidad de errores intermitentes como `Failed to fetch` sin depender solo del banner temporal del chat
- Se reduce la perdida de contexto sobre preferencias secundarias del usuario dentro de una conversacion

## [0.4.3] - 2026-03-29
### Changed
- El envio de chat en cloud deja de hacer pre-chequeos de conectividad por proveedor en cada mensaje y prioriza envio inmediato con rotacion por error real
- La imagen de referencia del personaje solo se adjunta como contexto interno en el primer turno del chat para reducir payload repetido

### Fixed
- Menor latencia y menos sensacion de cuelgue al iniciar respuestas en modo cloud/smart
- Se reduce el costo de red y procesamiento cuando hay personaje visual activo en conversaciones largas

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
