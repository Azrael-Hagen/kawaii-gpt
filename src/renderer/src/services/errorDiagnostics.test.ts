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
  })
})