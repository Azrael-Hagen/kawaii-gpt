import { describe, expect, it } from 'vitest'
import { computeChatRequestBudget } from '@/services/chatRequestBudget'

describe('chatRequestBudget', () => {
  it('caps short prompts to avoid oversized completion budgets', () => {
    const budget = computeChatRequestBudget({
      baseMaxTokens: 1200,
      promptChars: 16,
      contextChars: 1200,
      providerLatencyMs: 200,
      networkRttMs: 50,
    })

    expect(budget.promptTokens).toBeGreaterThan(0)
    expect(budget.maxTokens).toBe(220)
  })

  it('reduces output budget for very large contexts', () => {
    const budget = computeChatRequestBudget({
      baseMaxTokens: 1200,
      promptChars: 200,
      contextChars: 30000,
      providerLatencyMs: 500,
      networkRttMs: 100,
    })

    expect(budget.contextTokens).toBeGreaterThan(0)
    expect(budget.maxTokens).toBe(320)
  })
})
