import { describe, expect, it } from 'vitest'
import {
  detectCloudProvider,
  getCatalogModelsForBaseUrl,
  getImageModelCandidatesForBaseUrl,
  pickSmartModel,
  pickSmartModelWithOptions,
  providerSupportsImageGeneration,
} from '@/services/cloudCatalog'

describe('cloudCatalog', () => {
  it('detects known providers from base url', () => {
    expect(detectCloudProvider('https://openrouter.ai/api/v1')).toBe('openrouter')
    expect(detectCloudProvider('https://api.openai.com/v1')).toBe('openai')
    expect(detectCloudProvider('https://api.groq.com/openai/v1')).toBe('groq')
  })

  it('includes GPT family in OpenAI/OpenRouter catalogs', () => {
    const openai = getCatalogModelsForBaseUrl('https://api.openai.com/v1')
    const openrouter = getCatalogModelsForBaseUrl('https://openrouter.ai/api/v1')
    expect(openai.some(m => m.startsWith('gpt-5.4'))).toBe(true)
    expect(openrouter.some(m => m.includes('gpt-5.4'))).toBe(true)
  })

  it('picks fast model for short prompt and strong model for complex prompt', () => {
    const candidates = ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano']
    const quick = pickSmartModel('hola, resumen corto', candidates)
    const heavy = pickSmartModel('Analiza este codigo TypeScript y da un plan de refactor paso a paso', candidates)
    expect(quick).not.toBe('gpt-5.4')
    expect(heavy).toBe('gpt-5.4')
  })

  it('prefers less-restricted families when enabled', () => {
    const candidates = ['gpt-5.4-mini', 'deepseek/deepseek-r1', 'llama-3.3-70b']
    const picked = pickSmartModelWithOptions('Explica este tema sensible con detalle', candidates, undefined, {
      prioritizeUnrestricted: true,
      preferFreeTier: false,
    })
    expect(picked).not.toBe('gpt-5.4-mini')
  })

  it('detects image support by provider', () => {
    expect(providerSupportsImageGeneration('https://api.groq.com/openai/v1')).toBe(false)
    expect(providerSupportsImageGeneration('https://api.openai.com/v1')).toBe(true)
    expect(providerSupportsImageGeneration('https://api.together.xyz/v1')).toBe(true)
  })

  it('builds provider-aware image model candidates', () => {
    const openrouter = getImageModelCandidatesForBaseUrl('https://openrouter.ai/api/v1', 'dall-e-3')
    const together = getImageModelCandidatesForBaseUrl('https://api.together.xyz/v1', 'dall-e-3')

    expect(openrouter[0]).toBe('openai/dall-e-3')
    expect(together.includes('black-forest-labs/FLUX.1-schnell-Free')).toBe(true)
  })
})
