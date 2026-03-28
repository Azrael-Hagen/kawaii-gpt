import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/types'
import { resolveModelForRoute, selectRoute, shouldUseWebSearch } from '@/services/smartRouting'

describe('smartRouting', () => {
  it('detects web-intent prompts', () => {
    expect(shouldUseWebSearch('Busca noticias de IA hoy')).toBe(true)
    expect(shouldUseWebSearch('Explícame recursión')).toBe(false)
  })

  it('routes smart mode to cloud for web queries', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      provider: 'smart' as const,
      webSearchEnabled: true,
      smartLongPromptThreshold: 700,
    }

    const decision = selectRoute(settings, 'Busca en la web qué pasó hoy con OpenAI')
    expect(decision.target).toBe('cloud')
    expect(decision.useWebSearch).toBe(true)
  })

  it('routes smart mode to local for short prompts', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      provider: 'smart' as const,
      webSearchEnabled: true,
    }

    const decision = selectRoute(settings, 'Dime un chiste corto')
    expect(decision.target).toBe('local')
  })

  it('resolves model by route', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      localModel: 'qwen2.5:0.5b',
      cloudModel: 'openai/gpt-4.1-mini',
      defaultModel: 'fallback',
    }

    expect(resolveModelForRoute('local', settings, settings.defaultModel)).toBe('qwen2.5:0.5b')
    expect(resolveModelForRoute('cloud', settings, settings.defaultModel)).toBe('openai/gpt-4.1-mini')
  })

  it('routes legacy-engine as manual cloud target without image generation', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      provider: 'legacy-engine' as const,
      imageGenEnabled: true,
    }

    const decision = selectRoute(settings, 'genera una imagen de un gato')
    expect(decision.target).toBe('legacy')
    expect(decision.generateImage).toBe(false)
  })

  it('routes smart mode to legacy for long creative prompts when enabled', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      provider: 'smart' as const,
      enableLegacyEngine: true,
      smartLongPromptThreshold: 500,
    }

    const decision = selectRoute(settings, 'Escribe una historia creative muy larga con varios giros narrativos y desarrollo emocional profundo para los personajes principales.')
    expect(decision.target).toBe('legacy')
    expect(decision.generateImage).toBe(false)
  })
})
