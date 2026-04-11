import { describe, expect, it } from 'vitest'
import { analyzeErrorMessage, appendErrorLog, createErrorLogEntry, updateErrorKnowledgeBase } from '@/services/errorDiagnostics'
import { DEFAULT_SETTINGS } from '@/types'

describe('errorDiagnostics', () => {
  it('classifies failed fetch as network error', () => {
    const analysis = analyzeErrorMessage('Failed to fetch from provider', { route: 'cloud' })
    expect(analysis.category).toBe('network')
    expect(analysis.autoRepairTried).toBe(true)
  })

  it('marks auto repaired entries when fallback succeeded', () => {
    const entry = createErrorLogEntry({
      source: 'chat',
      message: 'Failed to fetch',
      route: 'cloud->local',
      autoRepairApplied: true,
    })

    expect(entry.status).toBe('auto-repaired')
    expect(entry.analysis.autoRepairApplied).toBe(true)
  })

  it('stores latest generated report when issue was not repaired', () => {
    const entry = createErrorLogEntry({
      source: 'chat',
      message: 'Model not found',
      route: 'cloud',
    })

    const out = appendErrorLog(DEFAULT_SETTINGS, entry)
    expect(out.errorLogs).toHaveLength(1)
    expect(out.lastErrorReport).toContain('KawaiiGPT Error Report')
  })

  it('learns a successful repair case and reuses it as a suggestion', () => {
    const repaired = createErrorLogEntry({
      source: 'chat',
      message: 'Failed to fetch',
      route: 'cloud->local',
      autoRepairApplied: true,
      knowledgeBase: [],
    })

    const knowledgeBase = updateErrorKnowledgeBase([], repaired)
    const analysis = analyzeErrorMessage('Failed to fetch', {
      route: 'cloud->local',
      knowledgeBase,
    })

    expect(knowledgeBase).toHaveLength(1)
    expect(analysis.learnedSuggestion).toBe('switch_to_local')
    expect((analysis.learnedConfidence ?? 0) > 0).toBe(true)
    expect(knowledgeBase[0].recognitionNotes?.some(note => note.includes('signal:failed-fetch'))).toBe(true)
    expect(analysis.recognitionNotes.some(note => note.includes('category:network'))).toBe(true)
  })

  it('accumulates recognition notes and sample messages for repeated learned cases', () => {
    const first = createErrorLogEntry({
      source: 'chat',
      message: 'Failed to fetch from OpenRouter (429)',
      route: 'cloud->local',
      provider: 'cloud • gpt-4.1-mini',
      autoRepairApplied: true,
    })

    const second = createErrorLogEntry({
      source: 'chat',
      message: 'Failed to fetch from OpenRouter (503)',
      route: 'cloud->local',
      provider: 'cloud • gpt-4.1-mini',
      autoRepairApplied: true,
    })

    const learnedOnce = updateErrorKnowledgeBase([], first)
    const learnedTwice = updateErrorKnowledgeBase(learnedOnce, second)

    expect(learnedTwice[0].seenCount).toBe(2)
    expect((learnedTwice[0].recognitionNotes ?? []).length > 0).toBe(true)
    expect(learnedTwice[0].sampleMessages).toHaveLength(2)
  })

  it('reuses knowledge entry across providers when fingerprint and action match', () => {
    const first = createErrorLogEntry({
      source: 'chat',
      message: 'Failed to fetch from endpoint',
      route: 'cloud->local',
      provider: 'openai-compatible',
      autoRepairApplied: true,
    })

    const second = createErrorLogEntry({
      source: 'chat',
      message: 'Failed to fetch from endpoint',
      route: 'cloud->local',
      provider: 'openrouter',
      autoRepairApplied: true,
    })

    const learnedOnce = updateErrorKnowledgeBase([], first)
    const learnedTwice = updateErrorKnowledgeBase(learnedOnce, second)

    expect(learnedTwice).toHaveLength(1)
    expect(learnedTwice[0].seenCount).toBe(2)
  })

  it('learns prompt-limit failures as compact-context repairs', () => {
    const repaired = createErrorLogEntry({
      source: 'chat',
      message: 'Provider error (402): Prompt tokens limit exceeded: 3267 > 1900.',
      route: 'cloud->local',
      provider: 'cloud • openai/gpt-5.4-mini',
      autoRepairApplied: true,
    })

    const knowledgeBase = updateErrorKnowledgeBase([], repaired)
    const analysis = analyzeErrorMessage('Provider error (402): Prompt tokens limit exceeded: 2809 > 1900.', {
      route: 'cloud',
      provider: 'cloud • openai/gpt-5.4-mini',
      knowledgeBase,
    })

    expect(knowledgeBase[0].recommendedAction).toBe('compact_context')
    expect(analysis.recognitionNotes).toContain('signal:prompt-limit')
    expect(analysis.suggestedFix).toContain('Compactar el historial')
  })
})