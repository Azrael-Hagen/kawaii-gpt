import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OllamaClient } from '@/services/ollamaClient'

describe('OllamaClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('checkConnection returns true for ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const client = new OllamaClient('http://localhost:11434')
    await expect(client.checkConnection()).resolves.toBe(true)
  })

  it('listModels returns model list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3', modified_at: '', size: 123 }] })
    }))

    const client = new OllamaClient()
    const models = await client.listModels()
    expect(models[0].name).toBe('llama3')
  })

  it('chat returns message content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: 'assistant', content: 'hi!' } })
    }))

    const client = new OllamaClient()
    const out = await client.chat('llama3', [{ role: 'user', content: 'hello' }])
    expect(out).toBe('hi!')
  })
})
