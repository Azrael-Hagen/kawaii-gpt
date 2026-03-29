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
      visualIdentityPrompt: 'ojos verdes, pelo castaño ondulado, chaqueta negra elegante',
      profileImageDataUrl: 'data:image/png;base64,abc123',
      profileImageName: 'aleia.png',
      profileImageMimeType: 'image/png',
    })

    expect(out).toContain('Aleia')
    expect(out).toContain('compañera virtual romántica')
    expect(out).toContain('aleia.png')
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
      visualIdentityPrompt: '',
      profileImageDataUrl: '',
      profileImageName: '',
      profileImageMimeType: '',
    })).toBe('')
  })
})