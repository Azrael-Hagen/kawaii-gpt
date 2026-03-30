import { describe, expect, it } from 'vitest'
import { ingestReleaseKnowledge, parseReleaseKnowledge, summarizeReleaseKnowledge } from '@/services/releaseLearning'
import { DEFAULT_SETTINGS } from '@/types'

describe('releaseLearning', () => {
  it('parses changelog sections into release knowledge entries', () => {
    const parsed = parseReleaseKnowledge(`# Changelog\n\n## [1.2.3] - 2026-03-30\n### Added\n- Foo\n### Fixed\n- Bar\n`)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].version).toBe('1.2.3')
    expect(parsed[0].added[0]).toBe('Foo')
    expect(parsed[0].fixed[0]).toBe('Bar')
  })

  it('ingests unseen release entries into settings knowledge base', () => {
    const merged = ingestReleaseKnowledge(DEFAULT_SETTINGS, '0.4.4')
    expect(merged.length > 0).toBe(true)
    expect(merged.some(entry => entry.version === '0.4.4')).toBe(true)
  })

  it('summarizes current release knowledge', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      releaseKnowledgeBase: [
        { version: '9.9.9', date: '2026-03-30', added: ['Feature A'], changed: [], fixed: ['Bug B'], learnedAt: Date.now() },
      ],
    }

    const summary = summarizeReleaseKnowledge(settings, '9.9.9')
    expect(summary).toContain('Feature A')
    expect(summary).toContain('Bug B')
  })
})
