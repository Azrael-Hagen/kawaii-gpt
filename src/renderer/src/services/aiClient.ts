import type {
  AIModel,
  ChatClient,
  OpenAICompatibleChatChunk,
  OpenAICompatibleChatResponse,
  OpenAICompatibleModelResponse,
  ProviderSettings,
  Role,
} from '@/types'

const TIMEOUT_MS = 3_000
const MAX_ERROR_SNIPPET = 220

function truncateError(text: string): string {
  return text.length > MAX_ERROR_SNIPPET ? `${text.slice(0, MAX_ERROR_SNIPPET)}...` : text
}

function tryReadJsonError(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown }; message?: unknown }
    const fromError = typeof parsed.error?.message === 'string' ? parsed.error.message : ''
    const fromRoot = typeof parsed.message === 'string' ? parsed.message : ''
    const picked = (fromError || fromRoot).trim()
    return picked || null
  } catch {
    return null
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function buildAuthHeaders(apiKey?: string): HeadersInit {
  return apiKey
    ? {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      }
    : {
        'Content-Type': 'application/json',
      }
}

function sanitizeErrorPayload(raw: string): string {
  const jsonMessage = tryReadJsonError(raw)
  if (jsonMessage) return truncateError(jsonMessage)

  const compact = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\[nrt]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const lower = compact.toLowerCase()
  if (
    lower.includes('openrouter search') ||
    lower.includes('chat rankings') ||
    lower.includes('enterprise pricing') ||
    lower.includes('skip to content')
  ) {
    return 'Respuesta HTML inesperada del proveedor (endpoint invalido o no soportado).'
  }

  if (!compact) return 'Respuesta inválida del proveedor.'
  return truncateError(compact)
}

async function readErrorPayload(res: Response): Promise<string> {
  const text = await res.text()
  return sanitizeErrorPayload(text)
}

export class OllamaClient implements ChatClient {
  private readonly base: string

  constructor(baseUrl: string) {
    this.base = normalizeBaseUrl(baseUrl)
  }

  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/api/tags`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async listModels(): Promise<AIModel[]> {
    const res = await fetch(`${this.base}/api/tags`)
    if (!res.ok) throw new Error(`Failed to list Ollama models: ${res.statusText}`)

    const data = (await res.json()) as {
      models?: Array<{
        name: string
        modified_at: string
        size: number
      }>
    }

    return (data.models ?? []).map(model => ({
      id: model.name,
      name: model.name,
      provider: 'ollama',
      modifiedAt: model.modified_at,
      size: model.size,
    }))
  }

  async *streamChat(
    model: string,
    messages: Array<{ role: Role; content: string }>,
    systemPrompt?: string,
    temperature = 0.7,
    maxTokens = 400,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    const fullMessages = systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
      : messages

    const res = await fetch(`${this.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: fullMessages,
        stream: true,
        options: { temperature, num_predict: maxTokens },
      }),
      signal,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ollama error (${res.status}): ${text}`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error('Ollama stream is unavailable')

    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const raw = decoder.decode(value, { stream: true })
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const chunk = JSON.parse(trimmed) as { message?: { content?: string } }
          if (chunk.message?.content) yield chunk.message.content
        } catch {
          // Skip malformed chunk.
        }
      }
    }
  }

  async chat(
    model: string,
    messages: Array<{ role: Role; content: string }>,
    systemPrompt?: string,
    temperature = 0.7,
    maxTokens = 400,
  ): Promise<string> {
    const fullMessages = systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
      : messages

    const res = await fetch(`${this.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: fullMessages,
        stream: false,
        options: { temperature, num_predict: maxTokens },
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ollama error (${res.status}): ${text}`)
    }

    const data = (await res.json()) as { message?: { content?: string } }
    return data.message?.content ?? ''
  }
}

export class OpenAICompatibleClient implements ChatClient {
  private readonly base: string
  private readonly apiKey?: string
  private readonly appName = 'KawaiiGPT'

  constructor(baseUrl: string, apiKey?: string) {
    this.base = normalizeBaseUrl(baseUrl)
    this.apiKey = apiKey?.trim() || undefined
  }

  async checkConnection(): Promise<boolean> {
    if (!this.apiKey) return false

    try {
      const res = await fetch(`${this.base}/models`, {
        headers: buildAuthHeaders(this.apiKey),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async listModels(): Promise<AIModel[]> {
    if (!this.apiKey) throw new Error('API key is required for online providers.')

    const res = await fetch(`${this.base}/models`, {
      headers: buildAuthHeaders(this.apiKey),
    })

    if (!res.ok) {
      const text = await readErrorPayload(res)
      throw new Error(`Provider error (${res.status}): ${text}`)
    }

    const data = (await res.json()) as OpenAICompatibleModelResponse
    return (data.data ?? []).map(model => ({
      id: model.id,
      name: model.id,
      provider: 'openai-compatible',
    }))
  }

  async *streamChat(
    model: string,
    messages: Array<{ role: Role; content: string }>,
    systemPrompt?: string,
    temperature = 0.7,
    maxTokens = 1200,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    if (!this.apiKey) throw new Error('API key is required for online providers.')

    const fullMessages = systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
      : messages

    const res = await fetch(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(this.apiKey),
        'X-Title': this.appName,
      },
      body: JSON.stringify({
        model,
        messages: fullMessages,
        stream: true,
        temperature,
        max_tokens: maxTokens,
      }),
      signal,
    })

    if (!res.ok) {
      const text = await readErrorPayload(res)
      throw new Error(`Provider error (${res.status}): ${text}`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error('Streaming response unavailable')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''

      for (const event of events) {
        for (const line of event.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue

          const payload = trimmed.slice(5).trim()
          if (payload === '[DONE]') return
          if (!payload || payload.startsWith(':')) continue

          try {
            const chunk = JSON.parse(payload) as OpenAICompatibleChatChunk
            const delta = chunk.choices?.[0]?.delta?.content
            if (delta) yield delta
          } catch {
            // Skip malformed SSE payloads.
          }
        }
      }
    }
  }

  async chat(
    model: string,
    messages: Array<{ role: Role; content: string }>,
    systemPrompt?: string,
    temperature = 0.7,
    maxTokens = 1200,
  ): Promise<string> {
    if (!this.apiKey) throw new Error('API key is required for online providers.')

    const fullMessages = systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
      : messages

    const res = await fetch(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(this.apiKey),
        'X-Title': this.appName,
      },
      body: JSON.stringify({
        model,
        messages: fullMessages,
        stream: false,
        temperature,
        max_tokens: maxTokens,
      }),
    })

    if (!res.ok) {
      const text = await readErrorPayload(res)
      throw new Error(`Provider error (${res.status}): ${text}`)
    }

    const data = (await res.json()) as OpenAICompatibleChatResponse
    return data.choices?.[0]?.message?.content ?? ''
  }

  async generateImage(prompt: string, model = 'dall-e-3'): Promise<string> {
    if (!this.apiKey) throw new Error('API key required for image generation.')

    const res = await fetch(`${this.base}/images/generations`, {
      method: 'POST',
      headers: buildAuthHeaders(this.apiKey),
      body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024' }),
    })

    if (!res.ok) {
      const text = await readErrorPayload(res)
      const openRouterHint = this.base.includes('openrouter.ai') && res.status === 404
        ? ' OpenRouter no expone este endpoint de imagen para esta configuracion. Usa OpenAI API o cambia proveedor/modelo de imagen.'
        : ''
      throw new Error(`Image generation failed (${res.status}): ${text}${openRouterHint}`)
    }

    const data = await res.json() as { data: Array<{ url?: string; b64_json?: string }> }
    const first = data.data?.[0]
    if (!first) throw new Error('No image data in response.')
    if (first.url) return first.url
    if (first.b64_json) return `data:image/png;base64,${first.b64_json}`
    throw new Error('Image response has no url or b64_json.')
  }
}

export class LegacyEngineClient implements ChatClient {
  private readonly base: string
  private readonly apiKey?: string

  constructor(baseUrl: string, apiKey?: string) {
    this.base = normalizeBaseUrl(baseUrl)
    this.apiKey = apiKey?.trim() || undefined
  }

  async checkConnection(): Promise<boolean> {
    try {
      const health = await fetch(`${this.base}/health`, {
        headers: buildAuthHeaders(this.apiKey),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (health.ok) return true
    } catch {
      // Fallback to /models check for OpenAI-compatible legacy bridges.
    }

    try {
      const models = await fetch(`${this.base}/models`, {
        headers: buildAuthHeaders(this.apiKey),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      return models.ok
    } catch {
      return false
    }
  }

  async listModels(): Promise<AIModel[]> {
    const res = await fetch(`${this.base}/models`, {
      headers: buildAuthHeaders(this.apiKey),
    })

    if (!res.ok) {
      const text = await readErrorPayload(res)
      throw new Error(`Legacy engine error (${res.status}): ${text}`)
    }

    const data = (await res.json()) as OpenAICompatibleModelResponse
    const models = (data.data ?? []).map(model => ({
      id: model.id,
      name: model.id,
      provider: 'legacy-engine' as const,
      providerBaseUrl: this.base,
    }))
    if (models.length > 0) return models

    return [{
      id: 'legacy-default',
      name: 'legacy-default',
      provider: 'legacy-engine',
      providerBaseUrl: this.base,
    }]
  }

  async *streamChat(
    model: string,
    messages: Array<{ role: Role; content: string }>,
    systemPrompt?: string,
    temperature = 0.7,
    maxTokens = 1200,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    const fullMessages = systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
      : messages

    const res = await fetch(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: buildAuthHeaders(this.apiKey),
      body: JSON.stringify({
        model,
        messages: fullMessages,
        stream: true,
        temperature,
        max_tokens: maxTokens,
      }),
      signal,
    })

    if (!res.ok) {
      const text = await readErrorPayload(res)
      throw new Error(`Legacy engine error (${res.status}): ${text}`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error('Legacy streaming response unavailable')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''

      for (const event of events) {
        for (const line of event.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue

          const payload = trimmed.slice(5).trim()
          if (payload === '[DONE]') return
          if (!payload || payload.startsWith(':')) continue

          try {
            const chunk = JSON.parse(payload) as OpenAICompatibleChatChunk
            const delta = chunk.choices?.[0]?.delta?.content
            if (delta) yield delta
          } catch {
            // Skip malformed SSE payloads.
          }
        }
      }
    }
  }

  async chat(
    model: string,
    messages: Array<{ role: Role; content: string }>,
    systemPrompt?: string,
    temperature = 0.7,
    maxTokens = 1200,
  ): Promise<string> {
    const fullMessages = systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
      : messages

    const res = await fetch(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: buildAuthHeaders(this.apiKey),
      body: JSON.stringify({
        model,
        messages: fullMessages,
        stream: false,
        temperature,
        max_tokens: maxTokens,
      }),
    })

    if (!res.ok) {
      const text = await readErrorPayload(res)
      throw new Error(`Legacy engine error (${res.status}): ${text}`)
    }

    const data = (await res.json()) as OpenAICompatibleChatResponse
    return data.choices?.[0]?.message?.content ?? ''
  }
}

export function createChatClient(settings: ProviderSettings, apiKey?: string): ChatClient {
  if (settings.provider === 'smart') {
    throw new Error('Smart routing must choose a concrete provider before creating a client.')
  }

  if (settings.provider === 'openai-compatible') {
    return new OpenAICompatibleClient(settings.providerBaseUrl, apiKey)
  }

  if (settings.provider === 'legacy-engine') {
    return new LegacyEngineClient(settings.legacyEngineBaseUrl || settings.providerBaseUrl, apiKey)
  }

  return new OllamaClient(settings.providerBaseUrl)
}
