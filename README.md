# KawaiiGPT

Modern, intuitive, and cute desktop GUI to run and chat with AI models using local Ollama, cloud providers, or an intelligent smart balance mode.

## Tech Stack

- Electron + Vite + React + TypeScript
- TailwindCSS custom Kawaii theme
- Zustand for local persisted state
- Hybrid AI orchestration:
    - Local: Ollama (`/api/chat`, `/api/tags`)
    - Cloud: OpenAI-compatible providers (OpenRouter, OpenAI, Groq, etc.)
    - Smart mode: automatic local/cloud routing + token strategy + optional web context
- Vitest for unit tests
- Playwright for E2E tests

## Prerequisites

1. Node.js 20+
2. For local mode: Ollama installed and running
3. For cloud mode: an OpenAI-compatible provider API key

### Install Ollama (Windows, recommended)

```powershell
winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
```

If `ollama` is not recognized right after install, use the full executable path once:

```powershell
& "C:\Users\%USERNAME%\AppData\Local\Programs\Ollama\ollama.exe" --version
```

### Pull a local model

```powershell
ollama pull llama3.1:8b
```

## Run in dev mode

```powershell
npm install
npm run dev
```

If your terminal is not in the project folder, run:

```powershell
npm --prefix "c:\Users\Azrael\OneDrive\Documentos\Herramientas\GPT\Kawaii\kawaii-gpt" run dev
```

## Build app

```powershell
npm run build
```

## Run tests

```powershell
npm test
```

## Configure KawaiiGPT

Open Settings ⚙️ and configure:

- Provider mode: `Ollama`, `Cloud`, or `Smart`
- Endpoints:
    - Local URL (default): `http://localhost:11434`
    - Cloud URL example: `https://openrouter.ai/api/v1`
- API key for cloud providers
- Models:
    - Local model (example): `qwen2.5:0.5b`
    - Cloud model (example): `openai/gpt-4.1-mini`
- System prompt
- Temperature
- Streaming on/off
- Smart controls:
    - Local max tokens
    - Cloud max tokens
    - Long-prompt threshold
    - Web search enable/disable
    - Web search max results

## Supported Hybrid Modes

### 1. Local-first
- Provider: `Ollama`
- Base URL: `http://localhost:11434`
- Best when privacy matters and your machine can run the model

### 2. Cloud-first
- Provider: `Cloud`
- Example base URL: `https://openrouter.ai/api/v1`
- Best when you want lower local resource usage

### 3. Smart balance (recommended)
- Provider: `Smart`
- Local + cloud are configured at the same time
- Routing behavior:
    - Web/news/fresh-info prompts route to cloud and can attach web context
    - Long prompts route to cloud
    - Short prompts route to local
- Benefit: lower local resource use while preserving offline fallback

## Intelligent Tokens and Responses

Kawaii applies a lightweight policy per prompt:

- Coding prompts: lower temperature for precision
- Creative prompts: higher temperature for variety
- Short-summary prompts: lower max tokens
- Step-by-step prompts: larger token budget

Token budgets are configurable separately for local and cloud in Settings.

## Web Search Support

When enabled in Smart mode, web-intent prompts (for example: "busca", "noticias", "hoy", "latest") can include a recent web context block before generation.

- Source: DuckDuckGo Instant Answer API via Electron main process
- No browser CORS issues in renderer
- Result count controlled by `Web Search Max Results`

## 4-Step Functional Setup

### Step 1: Install local runtime and/or prepare cloud provider

Local Ollama:

```powershell
winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
```

Cloud provider:
- Create an API key in your provider dashboard
- Example: OpenRouter supports OpenAI-compatible chat completions and model listing

### Step 2: Make models available

Local:

```powershell
ollama pull llama3.1:8b
```

Online:
- Pick any available model from your provider after entering the API key and refreshing models

### Step 3: Run KawaiiGPT

```powershell
npm install
npm run dev
```

### Step 4: Validate real chat

1. Open Settings
2. Select `Smart` (recommended)
3. Configure `Local URL`, `Cloud URL`, API key, `Local model`, and `Cloud model`
4. Keep web search enabled if you want web-aware answers
5. Refresh models
6. Send two prompts:
    - "Explícame closures en JavaScript" (should prefer local)
    - "Busca noticias de IA de hoy y resúmelas" (should prefer cloud + web context)

## Project Structure

```
src/
├── main/               # Electron main process
├── preload/            # Secure bridge (contextBridge)
└── renderer/
    └── src/
        ├── components/
        │   ├── chat/
        │   ├── sidebar/
        │   ├── settings/
        │   └── ui/
        ├── hooks/
        ├── services/
        ├── store/
        ├── types/
        └── utils/
```

## Security Notes

- `contextIsolation: true`
- `nodeIntegration: false`
- External links open in system browser
- No API keys or secrets embedded

## Troubleshooting

### "AI offline" in title bar

1. If using Ollama, ensure the process is running:
   ```powershell
   ollama serve
   ```
2. Verify the provider, URL, and API key in Settings
3. Click refresh icon in Settings

### No models appear

If using Ollama, run:

```powershell
ollama list
```

If empty, pull one:

```powershell
ollama pull llama3.1:8b
```

If using an online provider:
- Confirm your API key is valid
- Confirm the base URL points to a Chat Completions-compatible API
- Refresh models from Settings

### Smart mode chooses wrong route

Tune these fields in Settings:
- `Smart Long Prompt Threshold`
- `Local Max Tokens`
- `Cloud Max Tokens`
- `Web Search Enabled`
