import { describe, expect, it } from 'vitest'
import { buildCharacterPrompt, buildSystemPrompt } from '@/utils/systemPrompt'

describe('systemPrompt', () => {
  it('appends character profile when enabled', () => {
    const out = buildSystemPrompt('Responde con detalle.', {
      enabled: true,
      name: 'Aleia',
      identity: 'compañera virtual romántica',
      personality: 'afectuosa, curiosa y juguetona',
      speakingStyle: 'cálido y coqueto',
      relationship: 'cercana y leal al usuario',
      scenario: 'presencia constante en el chat',
      behaviorRules: 'mantener consistencia emocional',
    })

    expect(out).toContain('Aleia')
    expect(out).toContain('compañera virtual romántica')
    expect(out).toContain('Responde con detalle.')
  })

  it('returns empty character block when disabled', () => {
    expect(buildCharacterPrompt({
      enabled: false,
      name: 'Aleia',
      identity: '',
      personality: '',
      speakingStyle: '',
      relationship: '',
      scenario: '',
      behaviorRules: '',
    })).toBe('')
  })
})