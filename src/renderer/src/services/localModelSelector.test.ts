import { describe, expect, it } from 'vitest'
import { isCompatibleLocalChatModel, pickMostIntelligentLocalModel, scoreLocalModelIntelligence } from '@/services/localModelSelector'
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
})
