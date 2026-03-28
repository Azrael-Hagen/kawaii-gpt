import type { OllamaModel, OllamaMessage, OllamaChatChunk } from '@/types'

const TIMEOUT_MS = 3_000  // connection probe timeout

export class OllamaClient {
  private readonly base: string

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.base = baseUrl.replace(/\/+$/, '')
  }

  // ── Health ─────────────────────────────────────────────────────────────────

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

  // ── Models ─────────────────────────────────────────────────────────────────

  async listModels(): Promise<OllamaModel[]> {
    const res = await fetch(`${this.base}/api/tags`)
    if (!res.ok) throw new Error(`Failed to list models: ${res.statusText}`)
    const data = (await res.json()) as { models?: OllamaModel[] }
    return data.models ?? []
  }

  // ── Streaming chat (async generator) ──────────────────────────────────────

  async *streamChat(
    model: string,
    messages: OllamaMessage[],
    systemPrompt?: string,
    temperature = 0.7,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    const fullMessages: OllamaMessage[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages

    const res = await fetch(`${this.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: fullMessages, stream: true, options: { temperature } }),
      signal,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ollama error (${res.status}): ${text}`)
    }

    const reader  = res.body!.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const raw = decoder.decode(value, { stream: true })
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const chunk = JSON.parse(trimmed) as OllamaChatChunk
          if (chunk.message?.content) yield chunk.message.content
        } catch {
          // Malformed chunk — skip silently
        }
      }
    }
  }

  // ── Non-streaming chat ─────────────────────────────────────────────────────

  async chat(
    model: string,
    messages: OllamaMessage[],
    systemPrompt?: string,
    temperature = 0.7,
  ): Promise<string> {
    const fullMessages: OllamaMessage[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages

    const res = await fetch(`${this.base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: fullMessages, stream: false, options: { temperature } }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ollama error (${res.status}): ${text}`)
    }

    const data = (await res.json()) as { message?: OllamaMessage }
    return data.message?.content ?? ''
  }
}

// Singleton factory — consumers call this instead of constructing directly
let _client: OllamaClient | null = null
let _lastBase = ''

export function getClient(baseUrl: string): OllamaClient {
  if (!_client || _lastBase !== baseUrl) {
    _client   = new OllamaClient(baseUrl)
    _lastBase = baseUrl
  }
  return _client
}
