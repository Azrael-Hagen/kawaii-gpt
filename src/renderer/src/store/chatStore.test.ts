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
})
