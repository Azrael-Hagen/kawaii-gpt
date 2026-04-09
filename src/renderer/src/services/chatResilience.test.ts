import { describe, expect, it } from 'vitest'
import {
  computeQuotaRetryMaxTokens,
  computeSafeContextCharsFromPromptLimit,
  derivePromptLimitFromRecentErrors,
  deriveTokenCapFromRecentErrors,
  extractAffordableTokensFromError,
  extractPromptLimitFromError,
} from '@/services/chatResilience'
import type { ErrorLogEntry } from '@/types'

describe('chatResilience', () => {
  it('extracts affordable token cap from OpenRouter credit error', () => {
    const message = 'Provider error (402): This request requires more credits. You requested up to 700 tokens, but can only afford 451.'
    expect(extractAffordableTokensFromError(message)).toBe(451)
  })

  it('computes reduced retry max tokens with safety margin', () => {
    const message = 'Provider error (402): You requested up to 700 tokens, but can only afford 451.'
    expect(computeQuotaRetryMaxTokens(700, message)).toBe(427)
  })

  it('derives token cap from recent cloud provider errors', () => {
    const now = Date.now()
    const logs: ErrorLogEntry[] = [
      {
        id: 'e1',
        source: 'chat',
        severity: 'error',
        message: 'Provider error (402): You requested up to 700 tokens, but can only afford 451.',
        provider: 'cloud • openai/gpt-5.4-mini',
        route: 'cloud',
        status: 'report-ready',
        at: now - 2_000,
        analysis: {
          category: 'auth',
          probableCause: 'credits',
          suggestedFix: 'lower tokens',
          recognitionNotes: [],
          autoRepairTried: false,
          autoRepairApplied: false,
          reportMarkdown: 'x',
        },
      },
    ]

    expect(deriveTokenCapFromRecentErrors(logs, ['openai/gpt-5.4-mini'], now)).toBe(427)
  })

  it('extracts prompt limit from context-size provider errors', () => {
    const message = 'Provider error (402): Prompt tokens limit exceeded: 3267 > 1900.'
    expect(extractPromptLimitFromError(message)).toBe(1900)
  })

  it('derives prompt token limit from recent cloud provider errors', () => {
    const now = Date.now()
    const logs: ErrorLogEntry[] = [
      {
        id: 'e2',
        source: 'chat',
        severity: 'error',
        message: 'Provider error (402): Prompt tokens limit exceeded: 3267 > 1900.',
        provider: 'cloud • openai/gpt-5.4-mini',
        route: 'cloud',
        status: 'report-ready',
        at: now - 1_500,
        analysis: {
          category: 'performance',
          probableCause: 'context too large',
          suggestedFix: 'trim context',
          recognitionNotes: [],
          autoRepairTried: false,
          autoRepairApplied: false,
          reportMarkdown: 'x',
        },
      },
    ]

    expect(derivePromptLimitFromRecentErrors(logs, ['openai/gpt-5.4-mini'], now)).toBe(1900)
  })

  it('computes safe context chars from learned prompt limit', () => {
    const chars = computeSafeContextCharsFromPromptLimit(1900, 240)
    expect(chars).toBeGreaterThan(5_000)
    expect(chars).toBeLessThan(8_000)
  })
})
