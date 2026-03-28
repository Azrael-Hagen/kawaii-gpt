import { describe, it, expect } from 'vitest'
import { truncate, titleFromMessage, formatModelSize } from '@/utils/formatters'

describe('formatters', () => {
  it('truncate keeps short strings', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncate shortens long strings', () => {
    expect(truncate('abcdefghijklmnop', 8)).toBe('abcdefg…')
  })

  it('titleFromMessage creates fallback title', () => {
    expect(titleFromMessage('')).toBe('New Chat')
  })

  it('formatModelSize renders GB/MB', () => {
    expect(formatModelSize(1_073_741_824)).toContain('GB')
    expect(formatModelSize(1_048_576)).toContain('MB')
  })
})
