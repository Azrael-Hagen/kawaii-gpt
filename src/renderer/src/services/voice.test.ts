import { describe, expect, it } from 'vitest'
import { sanitizeForSpeech } from '@/services/voice'

describe('voice', () => {
  it('sanitizes markdown-heavy content for speech', () => {
    const input = 'Hola **mundo**. `const x = 1`\n\n[link](https://example.com)\n```ts\nconsole.log(x)\n```'
    const out = sanitizeForSpeech(input)
    expect(out).toContain('Hola mundo')
    expect(out).toContain('const x = 1')
    expect(out).toContain('link')
    expect(out).not.toContain('```')
  })
})
