import { describe, expect, it } from 'vitest'
import { computeCompletionCapFromPromptChars, estimateTokensFromChars } from '@/services/tokenBudget'

describe('tokenBudget', () => {
  it('estimates tokens from char count with stable ratio', () => {
    expect(estimateTokensFromChars(0)).toBe(0)
    expect(estimateTokensFromChars(38)).toBe(10)
    expect(estimateTokensFromChars(190)).toBe(50)
  })

  it('caps completion tokens for short prompts', () => {
    expect(computeCompletionCapFromPromptChars(60, 1200)).toBe(220)
    expect(computeCompletionCapFromPromptChars(160, 1200)).toBe(320)
    expect(computeCompletionCapFromPromptChars(300, 1200)).toBe(480)
  })

  it('respects fallback for long prompts', () => {
    expect(computeCompletionCapFromPromptChars(900, 900)).toBe(900)
    expect(computeCompletionCapFromPromptChars(200, 280)).toBe(280)
  })
})
