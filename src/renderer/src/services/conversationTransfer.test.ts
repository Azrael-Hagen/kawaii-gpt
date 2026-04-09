import { describe, expect, it } from 'vitest'
import {
  buildConversationExportPayload,
  parseConversationImportPayload,
} from '@/services/conversationTransfer'

describe('conversationTransfer', () => {
  it('builds export payload with expected schema', () => {
    const payload = buildConversationExportPayload([], null)
    expect(payload.schema).toBe('kawaii-gpt-conversations')
    expect(payload.version).toBe(1)
    expect(Array.isArray(payload.chats.conversations)).toBe(true)
  })

  it('parses import payload from chats shape', () => {
    const parsed = parseConversationImportPayload({
      chats: {
        activeId: 'c1',
        conversations: [
          {
            id: 'c1',
            title: 'Prueba',
            model: 'm1',
            createdAt: 1,
            updatedAt: 2,
            messages: [
              { id: 'm1', role: 'user', content: 'hola', timestamp: 1 },
            ],
            userMemory: [],
          },
        ],
      },
    })

    expect(parsed.conversations).toHaveLength(1)
    expect(parsed.activeId).toBe('c1')
    expect(parsed.conversations[0].messages[0].role).toBe('user')
  })

  it('returns empty import for invalid payload', () => {
    const parsed = parseConversationImportPayload('bad-data')
    expect(parsed.conversations).toHaveLength(0)
    expect(parsed.activeId).toBe(null)
  })
})
