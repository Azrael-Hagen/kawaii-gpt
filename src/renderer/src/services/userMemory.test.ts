import { describe, expect, it } from 'vitest'
import { extractImportantUserFacts, prependUserMemoryContext } from '@/services/userMemory'
import type { ChatMessageInput, UserMemoryFact } from '@/types'

describe('userMemory', () => {
  it('extracts important user facts from natural language', () => {
    const facts = extractImportantUserFacts('Hola, me llamo Lucia y vivo en Sevilla. Mi color favorito es verde.')

    expect(facts.some(f => f.key === 'name' && f.value.toLowerCase().includes('lucia'))).toBe(true)
    expect(facts.some(f => f.key === 'location' && f.value.toLowerCase().includes('sevilla'))).toBe(true)
    expect(facts.some(f => f.key === 'favorite_color' && f.value.toLowerCase().includes('verde'))).toBe(true)
  })

  it('prepends memory context message when memory exists', () => {
    const messages: ChatMessageInput[] = [{ role: 'user', content: 'hola' }]
    const memory: UserMemoryFact[] = [
      { id: '1', key: 'name', value: 'Lucia', sourceMessageId: 'm1', updatedAt: Date.now() },
    ]

    const out = prependUserMemoryContext(messages, memory)
    expect(out).toHaveLength(2)
    expect(out[0].content).toContain('Memoria local del usuario')
    expect(out[0].content).toContain('name: Lucia')
  })
})
