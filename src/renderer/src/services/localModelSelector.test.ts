import { describe, expect, it } from 'vitest'
import { filterLocalModelsByHardwareCapacity, getRecommendedMinimumLocalModelSizeB, isCompatibleLocalChatModel, pickMostIntelligentLocalModel, scoreLocalModelIntelligence } from '@/services/localModelSelector'
import type { AIModel } from '@/types'

describe('localModelSelector', () => {
  it('filters non-chat local models', () => {
    expect(isCompatibleLocalChatModel('nomic-embed-text')).toBe(false)
    expect(isCompatibleLocalChatModel('bge-m3:latest')).toBe(false)
    expect(isCompatibleLocalChatModel('llama3.1:70b')).toBe(true)
  })

  it('scores larger reasoning models higher than tiny variants', () => {
    const strong = scoreLocalModelIntelligence('qwen3:32b')
    const tiny = scoreLocalModelIntelligence('qwen2.5:0.5b')
    expect(strong).toBeGreaterThan(tiny)
  })

  it('picks the most intelligent compatible local model', () => {
    const models: AIModel[] = [
      { id: '1', name: 'qwen2.5:0.5b', provider: 'ollama' },
      { id: '2', name: 'nomic-embed-text', provider: 'ollama' },
      { id: '3', name: 'qwen3:32b', provider: 'ollama' },
      { id: '4', name: 'llama3.1:8b', provider: 'ollama' },
    ]

    const picked = pickMostIntelligentLocalModel(models)
    expect(picked?.name).toBe('qwen3:32b')
  })

  it('defines a higher minimum model floor for stronger hardware', () => {
    expect(getRecommendedMinimumLocalModelSizeB({ totalMemoryGB: 32, cpuCores: 12, architecture: 'x64' })).toBe(8)
    expect(getRecommendedMinimumLocalModelSizeB({ totalMemoryGB: 32, cpuCores: 12, architecture: 'x64' }, 'conservative')).toBe(7)
    expect(getRecommendedMinimumLocalModelSizeB({ totalMemoryGB: 32, cpuCores: 12, architecture: 'x64' }, 'aggressive')).toBe(12)
    expect(getRecommendedMinimumLocalModelSizeB({ totalMemoryGB: 16, cpuCores: 8, architecture: 'x64' })).toBe(4)
    expect(getRecommendedMinimumLocalModelSizeB({ totalMemoryGB: 8, cpuCores: 4, architecture: 'x64' }, 'off')).toBe(0)
  })

  it('filters out undersized local models when hardware supports larger ones', () => {
    const models: AIModel[] = [
      { id: '1', name: 'qwen2.5:3b', provider: 'ollama' },
      { id: '2', name: 'llama3.1:8b', provider: 'ollama' },
      { id: '3', name: 'qwen3:32b', provider: 'ollama' },
      { id: '4', name: 'nomic-embed-text', provider: 'ollama' },
    ]

    const filtered = filterLocalModelsByHardwareCapacity(models, {
      totalMemoryGB: 32,
      cpuCores: 12,
      architecture: 'x64',
    }, 'auto')

    expect(filtered.map(m => m.name)).toEqual(['llama3.1:8b', 'qwen3:32b'])
  })

  it('keeps compatible models when all are below the hardware floor', () => {
    const models: AIModel[] = [
      { id: '1', name: 'qwen2.5:3b', provider: 'ollama' },
      { id: '2', name: 'llama3.2:1b', provider: 'ollama' },
      { id: '3', name: 'nomic-embed-text', provider: 'ollama' },
    ]

    const filtered = filterLocalModelsByHardwareCapacity(models, {
      totalMemoryGB: 64,
      cpuCores: 16,
      architecture: 'x64',
    }, 'aggressive')

    expect(filtered.map(m => m.name)).toEqual(['qwen2.5:3b', 'llama3.2:1b'])
  })

  it('can disable hardware-based local filtering explicitly', () => {
    const models: AIModel[] = [
      { id: '1', name: 'qwen2.5:3b', provider: 'ollama' },
      { id: '2', name: 'llama3.1:8b', provider: 'ollama' },
    ]

    const filtered = filterLocalModelsByHardwareCapacity(models, {
      totalMemoryGB: 64,
      cpuCores: 16,
      architecture: 'x64',
    }, 'off')

    expect(filtered.map(m => m.name)).toEqual(['qwen2.5:3b', 'llama3.1:8b'])
  })
})
