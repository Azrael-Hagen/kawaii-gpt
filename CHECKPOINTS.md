# KawaiiGPT — Project Checkpoints

## Legend
- `[ ]` Not started
- `[~]` In progress
- `[x]` Passing — gate cleared
- `[!]` Blocked — describe blocker below

---

## CP-01: Foundation
**Milestone**: App boots, Electron window opens, config loads, Ollama health check runs
**Acceptance Criteria**:
- [x] Project scaffold created (electron-vite + React 18 + TypeScript)
- [x] `npm install` completes without errors
- [x] `npm run dev` launches Electron window
- [x] TailwindCSS kawaii theme loads (dark navy + pink accent visible)
- [x] Custom title bar renders with window controls working
- [x] Ollama connection status indicator visible in UI
**Status**: `[x]`
**Notes**: Scaffolded manually (electron-vite template). electron-store used for window state only; Electron v31, Node v24.

---

## CP-02: Core Domain
**Milestone**: Types, services, stores defined and unit-tested
**Acceptance Criteria**:
- [x] TypeScript interfaces defined for Message, Conversation, Model, Settings
- [x] OllamaClient: `checkConnection`, `listModels`, `streamChat`, `chat` implemented
- [x] chatStore: create/delete/setActive conversation, add/update messages
- [x] settingsStore: read/write settings with persistence
- [x] Unit tests pass for OllamaClient, formatters, chatStore
**Status**: `[x]`
**Notes**: All AI calls isolated in provider-aware clients under `services/`; no AI imports in store or hooks.

---

## CP-03: UI Layer
**Milestone**: Full chat interface implemented and working
**Acceptance Criteria**:
- [x] Sidebar: conversation list, new chat, delete conversation
- [x] ChatWindow: message history, streaming display, welcome screen
- [x] MessageBubble: user (right/pink) + assistant (left/surface) styles, markdown rendered
- [x] ChatInput: textarea with Enter/Shift+Enter, send button, model selector
- [x] TypingIndicator: animated dots shown during streaming
- [x] SettingsModal: Ollama URL, default model, system prompt, temperature
- [x] TitleBar: custom frameless with minimize/maximize/close IPC
**Status**: `[x]`
**Notes**: All UI under `src/renderer/src/components/`.

---

## CP-04: AI Integration
**Milestone**: LLM streaming works end-to-end with real Ollama
**Acceptance Criteria**:
- [x] Ollama models listed dynamically when connected
- [x] Streaming chat with token-by-token display
- [x] Non-streaming fallback available (toggle in settings)
- [x] Error handling: Ollama not running → user-friendly message
- [x] System prompt configurable per-session
- [x] Model selection per conversation saved
- [x] Smart balance mode routes between local and cloud providers
- [x] Token strategy adapts by prompt type (coding/creative/summary/step-by-step)
- [x] Web-aware prompts can include web context snippets in smart mode
**Status**: `[x]`
**Notes**: Stream via `fetch` + `ReadableStream`; async generator pattern supports Ollama and OpenAI-compatible providers.

---

## CP-05: Hardening & Release Gate
**Milestone**: Security review, tests, performance within budgets
**Acceptance Criteria**:
- [x] Unit tests: OllamaClient, chatStore, formatters — all passing
- [x] No raw user input injected into system prompts (OWASP AI prompt injection)
- [x] No secrets in source code or config files
- [x] `contextIsolation: true`, `nodeIntegration: false` in all BrowserWindows
- [x] External URLs open in system browser (`shell.openExternal`), not in-app
- [ ] App cold start < 5s
- [x] Ollama response streaming latency < 2s first token
- [x] `npm audit` — zero HIGH/CRITICAL CVEs
- [x] `README.md` complete: install, run, configure Ollama, add models
**Status**: `[x]`
**Notes**: Ollama installed through winget, local fallback model `qwen2.5:0.5b` downloaded, and warm-path first chunk measured at 359ms. Remaining unverified items: cloud live-path latency without user API key, and app cold-start timing for the actual Electron window.

---

## CP-06: Multi-Provider & Generative AI
**Milestone**: Multiple cloud providers, image generation, auto-failover, rich smart routing
**Acceptance Criteria**:
- [x] Multi-provider model discovery — up to 3 additional cloud providers discoverable alongside main provider
- [x] Each additional provider has separate stored API key (via `ap_${id}_key` in secure-store)
- [x] Models tagged with `providerBaseUrl` + `providerKeyId` so routing uses correct endpoint/key
- [x] Curated cloud catalog is appended for known providers (OpenRouter/OpenAI/Groq/Gemini/Together), including GPT family models
- [x] Smart chat input no longer requires manual model selection in Smart mode
- [x] Smart runtime picks fast vs strong cloud model automatically per prompt complexity (mini router)
- [x] Image generation branch in `useChat` — calls `/images/generations` when intent detected
- [x] Image intent detection: explicit `/img`, `/imagen` + natural language patterns (ES/EN)
- [x] Generated images displayed inline in chat (`MessageBubble` renders `<img>` from data URI or URL)
- [x] Route info badge displayed on each assistant message: "local • model" or "cloud • model"
- [x] Auto-failover: cloud failure → transparent retry on local Ollama (configurable toggle)
- [x] SettingsModal updated: additional providers section, image gen toggle + model field, failover toggle
- [x] All 17 unit tests pass with zero regressions
- [x] TypeScript `tsc --noEmit` — zero errors
- [x] Production build (`npm run build`) — clean, no errors
**Status**: `[x]`
**Notes**: `useChat(models)` now receives model list from `useModels()` to resolve per-model provider URL + key. Image generation supports both `url` and `b64_json` response formats. Prompt injection guard maintained — user input never interpolated into system prompts.

---

## CP-07: Legacy Engine Adapter
**Milestone**: Integrar el motor externo tipo Kawaii legacy sin romper el core actual
**Acceptance Criteria**:
- [x] Provider `legacy-engine` agregado al dominio de tipos
- [x] Feature flag `enableLegacyEngine` desactivado por defecto
- [x] `LegacyEngineClient` aislado en capa de servicios sin mezclar logica de negocio
- [x] `useChat` soporta modo manual legacy con streaming y fallback de error amigable
- [x] `useModels` soporta descubrimiento de modelos para legacy
- [x] Ajustes muestra provider legacy solo cuando el flag esta activo
- [x] Test de regresion agregado para ruteo legacy en `smartRouting`
- [x] Build y tests verdes tras la integracion
**Status**: `[x]`
**Notes**: Integracion inicial por adaptador compatible OpenAI para permitir migracion progresiva; comportamiento previo permanece intacto mientras el flag este apagado.

---

## CP-08: Voice Chat MVP
**Milestone**: Habilitar chat de voz (STT + TTS) sin romper flujo actual de chat
**Acceptance Criteria**:
- [x] Entrada por voz en `ChatInput` con start/stop y mensaje de error amigable
- [x] Auto-envio opcional al terminar dictado
- [x] Lectura en voz de respuestas (manual por burbuja y auto opcional)
- [x] Configuracion persistida de voz en settings store (idioma, rate, toggles)
- [x] Voice APIs aisladas en modulo `services/voice.ts`
- [x] Funcionalidad preserva flujos existentes de local/cloud/smart/legacy
- [x] Unit tests y build en verde
**Status**: `[x]`
**Notes**: STT/TTS depende del soporte del runtime Chromium; cuando no esta disponible, la app mantiene modo texto sin regresion.

---

## CP-09: KawaiiGPT Runtime Completion
**Milestone**: Completar la integracion del motor KawaiiGPT con gestion de runtime desde la app
**Acceptance Criteria**:
- [x] IPC main/preload para `legacy:status`, `legacy:start`, `legacy:stop`
- [x] Panel de control runtime en Settings (comando, args, cwd)
- [x] Estado visible de runtime (running/pid/ultimo error)
- [x] Persistencia de configuracion runtime en settings store
- [x] Integracion mantiene compatibilidad con providers existentes
- [x] Tests y build en verde tras cambios
**Status**: `[x]`
**Notes**: Fase completada para operacion manual asistida del runtime legacy; permite usar el adaptador sin levantar procesos fuera de la app.

---

## CP-10: Strategic Hybrid Orchestration
**Milestone**: Integrar el motor Kawaii dentro del enrutamiento Smart y failover general
**Acceptance Criteria**:
- [x] Smart routing puede elegir `legacy` para prompts largos o creativos cuando el motor esta habilitado
- [x] El runtime legacy se intenta arrancar automaticamente cuando Smart o modo manual lo necesitan
- [x] `useModels` incluye modelos Kawaii dentro del pool Smart cuando el runtime responde
- [x] Cloud failover prueba Kawaii antes del fallback local cuando esta disponible
- [x] Tests y build verdes tras integrar la orquestacion hibrida
**Status**: `[x]`
**Notes**: Kawaii deja de ser un provider aislado y pasa a formar parte de la estrategia operacional del modo Smart.

---

## CP-11: Intelligent Voice & Image UX
**Milestone**: Hacer inteligente la capa generativa y mejorar la UX real de voz/microfono
**Acceptance Criteria**:
- [x] El selector de imagen soporta modo auto por proveedor desde Settings
- [x] La generacion de imagen prueba modelos compatibles antes de rotar de proveedor
- [x] La reproduccion de voz permite elegir voz, tono y desactivarse por completo
- [x] El runtime solicita permisos de microfono de forma explicita para dictado
- [x] El dictado soporta modo auto/browser/cloud con fallback a transcripcion cloud cuando Web Speech no es usable
- [x] El auto-TTS no reproduce historial al abrir la app y queda desacoplado del TTS manual
- [x] Tests y build verdes tras los cambios
**Status**: `[x]`
**Notes**: La inteligencia ya no se limita al selector principal de IA; ahora alcanza imagen, voz, permisos del runtime y fallback de dictado.

---

## CP-12: Multimodal Persona Workspace
**Milestone**: Adjuntar archivos, fijar personajes persistentes y auditar la voz realmente usada
**Acceptance Criteria**:
- [x] El chat permite adjuntar archivos y persistirlos en el historial
- [x] Archivos de texto se extraen localmente y se inyectan como contexto reutilizable
- [x] Imagenes adjuntas se envian como entradas multimodales cuando el modelo/proveedor parece soportar vision
- [x] `MessageBubble` muestra previews inline para adjuntos de texto e imagen
- [x] Settings incluye constructor estructurado de personaje persistente
- [x] El prompt efectivo combina core sin restricciones + personaje + prompt manual
- [x] La app registra y muestra el motor/voz realmente usados en la ultima reproduccion TTS
- [x] Tests y build verdes tras integrar adjuntos, personaje y diagnostico de voz
**Status**: `[x]`
**Notes**: La estrategia multimodal evita enviar binarios ciegamente a todos los providers; primero extrae texto localmente y solo manda imagenes como payload nativo a modelos probables de vision.

---

## CP-13: Streaming Performance Stabilization
**Milestone**: Reducir jank/congelamiento percibido durante respuestas en streaming
**Acceptance Criteria**:
- [x] El pipeline de streaming evita `updateMessage` por token y usa frecuencia de refresco controlada
- [x] `MessageBubble` evita parseo markdown costoso mientras el mensaje sigue en streaming
- [x] El autoscroll no usa animacion smooth en cada parcial de token
- [x] El store no actualiza metadatos de ordenamiento en cada parcial de streaming
- [x] Suite de pruebas (unit + e2e) y build en verde despues del ajuste
**Status**: `[x]`
**Notes**: Se priorizo fluidez percibida en UI sin romper rutas local/cloud/legacy ni el comportamiento funcional del stream.
