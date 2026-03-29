import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '@/store/chatStore'

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [], activeId: null })
  })

  it('creates a conversation and sets active', () => {
    const id = useChatStore.getState().create('llama3')
    const st = useChatStore.getState()
    expect(st.activeId).toBe(id)
    expect(st.conversations.length).toBe(1)
    expect(st.conversations[0].model).toBe('llama3')
  })

  it('adds and updates message', () => {
    const conv = useChatStore.getState().create('llama3')
    const msg  = useChatStore.getState().addMessage(conv, { role: 'user', content: 'Hi', timestamp: Date.now() })

    useChatStore.getState().updateMessage(conv, msg, 'Hello', false)
    const updated = useChatStore.getState().conversations[0].messages[0]
    expect(updated.content).toBe('Hello')
  })

  it('persists attachments on messages', () => {
    const conv = useChatStore.getState().create('llama3')
    useChatStore.getState().addMessage(conv, {
      role: 'user',
      content: 'Revisa este archivo',
      timestamp: Date.now(),
      attachments: [
        {
          id: 'att-1',
          name: 'nota.md',
          mimeType: 'text/markdown',
          size: 32,
          kind: 'text',
          previewText: 'hola',
          extractedText: 'hola',
        },
      ],
    })

    const stored = useChatStore.getState().conversations[0].messages[0]
    expect(stored.attachments).toHaveLength(1)
    expect(stored.attachments?.[0].name).toBe('nota.md')
  })

  it('stores and updates user memory facts per conversation', () => {
    const conv = useChatStore.getState().create('llama3')

    useChatStore.getState().upsertUserMemory(conv, {
      key: 'name',
      value: 'Azrael',
      sourceMessageId: 'm1',
    })

    useChatStore.getState().upsertUserMemory(conv, {
      key: 'name',
      value: 'Az',
      sourceMessageId: 'm2',
    })

    const memory = useChatStore.getState().conversations[0].userMemory
    expect(memory).toHaveLength(1)
    expect(memory[0].value).toBe('Az')
    expect(memory[0].sourceMessageId).toBe('m2')
  })

  it('clears user memory when conversation is cleared', () => {
    const conv = useChatStore.getState().create('llama3')

    useChatStore.getState().upsertUserMemory(conv, {
      key: 'location',
      value: 'Madrid',
      sourceMessageId: 'm3',
    })

    useChatStore.getState().clear(conv)
    const cleared = useChatStore.getState().conversations[0]

    expect(cleared.messages).toHaveLength(0)
    expect(cleared.userMemory).toHaveLength(0)
  })
})
