import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LegacyEngineClient, OpenAICompatibleClient, OllamaClient, createChatClient } from '@/services/aiClient'

describe('aiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('creates Ollama client from settings', () => {
    const client = createChatClient({
      provider: 'ollama',
      providerBaseUrl: 'http://localhost:11434',
      localBaseUrl: 'http://localhost:11434',
      cloudBaseUrl: 'https://openrouter.ai/api/v1',
      legacyEngineBaseUrl: 'http://127.0.0.1:8765/v1',
    })
    expect(client).toBeInstanceOf(OllamaClient)
  })

  it('creates OpenAI-compatible client from settings', () => {
    const client = createChatClient({
      provider: 'openai-compatible',
      providerBaseUrl: 'https://openrouter.ai/api/v1',
      localBaseUrl: 'http://localhost:11434',
      cloudBaseUrl: 'https://openrouter.ai/api/v1',
      legacyEngineBaseUrl: 'http://127.0.0.1:8765/v1',
    }, 'secret')
    expect(client).toBeInstanceOf(OpenAICompatibleClient)
  })

  it('creates Legacy engine client from settings', () => {
    const client = createChatClient({
      provider: 'legacy-engine',
      providerBaseUrl: 'http://127.0.0.1:8765/v1',
      localBaseUrl: 'http://localhost:11434',
      cloudBaseUrl: 'https://openrouter.ai/api/v1',
      legacyEngineBaseUrl: 'http://127.0.0.1:8765/v1',
    }, 'secret')
    expect(client).toBeInstanceOf(LegacyEngineClient)
  })

  it('lists remote models from OpenAI-compatible endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'openai/gpt-4.1-mini' }] }),
    }))

    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', 'secret')
    const models = await client.listModels()
    expect(models[0].name).toBe('openai/gpt-4.1-mini')
  })

  it('returns chat content from OpenAI-compatible endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hello from cloud' } }] }),
    }))

    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', 'secret')
    const out = await client.chat('openai/gpt-4.1-mini', [{ role: 'user', content: 'Hi' }])
    expect(out).toBe('Hello from cloud')
  })

  it('sanitizes HTML error payload from provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '<html><body><script>bad()</script><h1>Not Found</h1></body></html>',
    }))

    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', 'secret')
    await expect(client.chat('gpt-5.4-mini', [{ role: 'user', content: 'hola' }]))
      .rejects.toThrow(/Provider error \(404\): Not Found/)
  })

  it('sanitizes noisy OpenRouter HTML in image errors and adds actionable hint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '<html><body>OpenRouter Search / Models Chat Rankings Apps Enterprise Pricing Docs Skip to content</body></html>',
    }))

    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', 'secret')
    await expect(client.generateImage?.('genera un gato', 'dall-e-3'))
      .rejects.toThrow(/Image generation failed \(404\): Respuesta HTML inesperada del proveedor \(endpoint invalido o no soportado\)\. OpenRouter no expone este endpoint de imagen/)
  })
})
