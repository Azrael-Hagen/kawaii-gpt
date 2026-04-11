import { describe, expect, it } from 'vitest'
import { buildProviderConfigExportPayload, parseProviderConfigImportPayload } from '@/services/providerConfigTransfer'
import { DEFAULT_SETTINGS } from '@/types'

describe('providerConfigTransfer', () => {
  it('exports provider settings and secrets with runtime metadata', () => {
    const payload = buildProviderConfigExportPayload(
      {
        ...DEFAULT_SETTINGS,
        provider: 'smart',
        providerBaseUrl: 'https://openrouter.ai/api/v1',
        cloudModel: 'openai/gpt-5.4-mini',
        defaultModel: 'openai/gpt-5.4-mini',
        additionalProviders: [
          { id: 'ap1', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', enabled: true },
          { id: 'ap2', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', enabled: false },
          { id: 'ap3', name: '', baseUrl: '', enabled: false },
        ],
      },
      {
        mainApiKey: 'main-key',
        additionalApiKeys: {
          ap1: 'groq-key',
        },
      },
      {
        mode: 'dev',
        url: 'http://localhost:5173/',
        origin: 'http://localhost:5173',
      },
    )

    expect(payload.schema).toBe('kawaii-gpt-provider-config')
    expect(payload.runtime.mode).toBe('dev')
    expect(payload.providerConfig.cloudModel).toBe('openai/gpt-5.4-mini')
    expect(payload.secrets.additionalApiKeys.ap1).toBe('groq-key')
  })

  it('parses provider settings payload and normalizes defaults', () => {
    const parsed = parseProviderConfigImportPayload({
      schema: 'kawaii-gpt-provider-config',
      providerConfig: {
        provider: 'smart',
        providerBaseUrl: 'https://openrouter.ai/api/v1',
        localBaseUrl: 'http://localhost:11434',
        cloudBaseUrl: 'https://openrouter.ai/api/v1',
        legacyEngineBaseUrl: 'http://127.0.0.1:8765/v1',
        defaultModel: 'openai/gpt-5.4-mini',
        localModel: 'qwen2.5:0.5b',
        cloudModel: 'openai/gpt-5.4-mini',
        legacyModel: 'legacy-default',
        additionalProviders: [
          { id: 'ap1', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', enabled: true },
        ],
        autoFailover: true,
        preferFreeTier: true,
        prioritizeUnrestricted: true,
        smartLongPromptThreshold: 700,
        cloudMaxTokens: 900,
        localMaxTokens: 500,
        webSearchEnabled: true,
        webSearchMaxResults: 6,
        enableLegacyEngine: false,
        legacyRuntimeCommand: 'python',
        legacyRuntimeArgs: 'kawai.py --api --port 8765',
        legacyRuntimeCwd: 'C:/tmp',
      },
      secrets: {
        mainApiKey: 'main-key',
        additionalApiKeys: {
          ap1: 'groq-key',
        },
      },
      runtime: {
        mode: 'packaged',
        url: 'file:///app',
        origin: 'file://',
      },
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.providerConfig.provider).toBe('smart')
    expect(parsed?.providerConfig.additionalProviders).toHaveLength(1)
    expect(parsed?.secrets.mainApiKey).toBe('main-key')
    expect(parsed?.runtime?.mode).toBe('packaged')
  })
})