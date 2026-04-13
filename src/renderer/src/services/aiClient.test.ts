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

  it('sends attachment context and image inputs to OpenAI-compatible vision models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Vision ok' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', 'secret')
    await client.chat('gpt-5.4-mini', [{
      role: 'user',
      content: 'Analiza esto',
      attachments: [
        {
          id: 'txt-1',
          name: 'nota.md',
          mimeType: 'text/markdown',
          size: 24,
          kind: 'text',
          extractedText: '# hola mundo',
          previewText: '# hola mundo',
        },
        {
          id: 'img-1',
          name: 'captura.png',
          mimeType: 'image/png',
          size: 128,
          kind: 'image',
          dataUrl: 'data:image/png;base64,ZmFrZQ==',
        },
      ],
    }])

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.messages[0].content[0].text).toContain('Archivo adjunto: nota.md')
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/png;base64,ZmFrZQ==')
  })

  it('sends image blobs and text attachment context to Ollama vision models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'Local vision ok' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new OllamaClient('http://localhost:11434')
    await client.chat('llava:latest', [{
      role: 'user',
      content: 'Describe la imagen',
      attachments: [
        {
          id: 'img-1',
          name: 'captura.png',
          mimeType: 'image/png',
          size: 128,
          kind: 'image',
          dataUrl: 'data:image/png;base64,ZmFrZQ==',
        },
        {
          id: 'txt-1',
          name: 'codigo.ts',
          mimeType: 'text/plain',
          size: 40,
          kind: 'text',
          extractedText: 'const hello = true',
          previewText: 'const hello = true',
        },
      ],
    }])

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.messages[0].images).toEqual(['ZmFrZQ=='])
    expect(body.messages[0].content).toContain('Archivo adjunto: codigo.ts')
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

  it('forwards abort signal in image generation requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://example.com/image.png' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new OpenAICompatibleClient('https://api.openai.com/v1', 'secret')
    const controller = new AbortController()
    await client.generateImage?.('genera un paisaje', 'gpt-image-1', controller.signal)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const options = fetchMock.mock.calls[0][1] as { signal?: AbortSignal }
    expect(options.signal).toBeDefined()
  })
})
