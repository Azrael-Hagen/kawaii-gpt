import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getResolvedSystemVoiceName,
  normalizeTranscriptionLanguage,
  pickCloudVoiceForLanguage,
  sanitizeForSpeech,
  shouldFallbackRecognitionErrorToCloud,
  speakText,
  transcribeAudioWithOpenAI,
} from '@/services/voice'

describe('voice', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sanitizes markdown-heavy content for speech', () => {
    const input = 'Hola **mundo**. `const x = 1`\n\n[link](https://example.com)\n```ts\nconsole.log(x)\n```'
    const out = sanitizeForSpeech(input)
    expect(out).toContain('Hola mundo')
    expect(out).toContain('const x = 1')
    expect(out).toContain('link')
    expect(out).not.toContain('```')
  })

  it('picks a high-quality cloud voice for supported languages', () => {
    expect(pickCloudVoiceForLanguage('es-ES')).toBe('marin')
    expect(pickCloudVoiceForLanguage('en-US')).toBe('cedar')
    expect(pickCloudVoiceForLanguage('fr-FR', 'alloy')).toBe('alloy')
  })

  it('normalizes locale tags for cloud transcription', () => {
    expect(normalizeTranscriptionLanguage('es-ES')).toBe('es')
    expect(normalizeTranscriptionLanguage('en-US')).toBe('en')
  })

  it('falls back to cloud transcription for runtime speech errors that are browser-engine specific', () => {
    expect(shouldFallbackRecognitionErrorToCloud('network')).toBe(true)
    expect(shouldFallbackRecognitionErrorToCloud('service-not-allowed')).toBe(true)
    expect(shouldFallbackRecognitionErrorToCloud('language-not-supported')).toBe(true)
    expect(shouldFallbackRecognitionErrorToCloud('audio-capture')).toBe(false)
  })

  it('sends audio transcription request to OpenAI-compatible endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ text: 'hola mundo' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const out = await transcribeAudioWithOpenAI({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret',
      audio: new Blob(['audio'], { type: 'audio/webm' }),
      lang: 'es-ES',
    })

    expect(out).toBe('hola mundo')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('resolves and reports the actual system voice used', () => {
    class FakeUtterance {
      text: string
      lang = ''
      rate = 1
      pitch = 1
      voice?: SpeechSynthesisVoice

      constructor(text: string) {
        this.text = text
      }
    }

    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance as unknown as typeof SpeechSynthesisUtterance)
    vi.stubGlobal('window', {
      speechSynthesis: {
        getVoices: () => [
          { name: 'Microsoft Alvaro', lang: 'es-ES', default: false },
          { name: 'Robot Voice', lang: 'en-US', default: false },
        ],
        cancel: vi.fn(),
        speak: vi.fn(),
      },
    })

    expect(getResolvedSystemVoiceName('es-ES')).toBe('Microsoft Alvaro')

    const result = speakText('Hola', { lang: 'es-ES' })
    expect(result).toEqual({
      engine: 'system',
      requestedVoice: '',
      resolvedVoice: 'Microsoft Alvaro',
    })
  })
})
