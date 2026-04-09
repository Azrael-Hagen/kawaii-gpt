import { describe, expect, it } from 'vitest'
import {
  addChatTraceEvent,
  clearChatTraces,
  finishChatTrace,
  getRecentChatTraces,
  startChatTrace,
  summarizeChatTrace,
} from '@/services/chatTrace'

describe('chatTrace', () => {
  it('records lifecycle and summary of a trace', () => {
    clearChatTraces()
    const id = startChatTrace({
      providerMode: 'smart',
      model: 'openai/gpt-5.4-mini',
      promptChars: 42,
      attachmentCount: 1,
    })

    addChatTraceEvent(id, 'route_decision', { target: 'cloud' })
    addChatTraceEvent(id, 'cloud_attempt_start', { provider: 'principal', maxTokens: 700 })
    finishChatTrace(id, 'success', { finalRoute: 'cloud', provider: 'principal' })

    const traces = getRecentChatTraces(5)
    expect(traces).toHaveLength(1)
    expect(traces[0].status).toBe('success')
    expect((traces[0].durationMs ?? 0) >= 0).toBe(true)

    const summary = summarizeChatTrace(traces[0])
    expect(summary).toContain('status=success')
    expect(summary).toContain('route_decision')
    expect(summary).toContain('cloud_attempt_start')
  })

  it('keeps traces in reverse chronological order', () => {
    clearChatTraces()
    const first = startChatTrace({ providerMode: 'cloud', model: 'a', promptChars: 1, attachmentCount: 0 })
    finishChatTrace(first, 'failed')

    const second = startChatTrace({ providerMode: 'cloud', model: 'b', promptChars: 2, attachmentCount: 0 })
    finishChatTrace(second, 'aborted')

    const traces = getRecentChatTraces(2)
    expect(traces[0].id).toBe(second)
    expect(traces[1].id).toBe(first)
  })
})
