const DEFAULT_LANG = 'es-ES'

export interface AvailableVoice {
  name: string
  lang: string
  default: boolean
}

export function sanitizeForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/[>#*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getSpeechRecognitionCtor():
  | (new () => {
      lang: string
      continuous: boolean
      interimResults: boolean
      maxAlternatives: number
      onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
      onerror: ((event: { error?: string }) => void) | null
      onend: (() => void) | null
      start: () => void
      stop: () => void
    })
  | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => {
      lang: string
      continuous: boolean
      interimResults: boolean
      maxAlternatives: number
      onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
      onerror: ((event: { error?: string }) => void) | null
      onend: (() => void) | null
      start: () => void
      stop: () => void
    }
    webkitSpeechRecognition?: new () => {
      lang: string
      continuous: boolean
      interimResults: boolean
      maxAlternatives: number
      onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
      onerror: ((event: { error?: string }) => void) | null
      onend: (() => void) | null
      start: () => void
      stop: () => void
    }
  }

  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isSpeechRecognitionSupported(): boolean {
  return Boolean(getSpeechRecognitionCtor())
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export async function requestMicrophoneAccess(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Acceso a micrófono no disponible en este runtime.')
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  for (const track of stream.getTracks()) track.stop()
}

export function listSpeechVoices(): AvailableVoice[] {
  if (!isSpeechSynthesisSupported()) return []
  return window.speechSynthesis.getVoices().map(v => ({
    name: v.name,
    lang: v.lang,
    default: v.default,
  }))
}

function scoreVoice(name: string, lang: string, targetLang: string): number {
  const lowerName = name.toLowerCase()
  const lowerLang = lang.toLowerCase()
  const wanted = targetLang.toLowerCase()
  let score = 0

  if (lowerLang === wanted) score += 8
  if (lowerLang.startsWith(wanted.split('-')[0])) score += 4
  if (/natural|neural|google|microsoft|helena|elvira|dalia|jenny|aria|alvaro|jorge/.test(lowerName)) score += 6
  if (/compact|robot|espeak/.test(lowerName)) score -= 4
  return score
}

function resolveVoice(lang: string, preferredName?: string): SpeechSynthesisVoice | undefined {
  if (!isSpeechSynthesisSupported()) return undefined
  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) return undefined

  if (preferredName?.trim()) {
    const exact = voices.find(v => v.name === preferredName)
    if (exact) return exact
  }

  return [...voices]
    .sort((a, b) => scoreVoice(b.name, b.lang, lang) - scoreVoice(a.name, a.lang, lang))[0]
}

function mapRecognitionError(errorCode?: string): string {
  switch ((errorCode || '').toLowerCase()) {
    case 'network':
      return 'No se pudo usar dictado por voz (error de red del motor de reconocimiento). Prueba de nuevo o escribe en texto.'
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Micrófono bloqueado. Habilita permisos de micrófono para la app.'
    case 'audio-capture':
      return 'No se detectó micrófono disponible.'
    case 'no-speech':
      return 'No se detectó voz. Inténtalo de nuevo.'
    case 'aborted':
      return 'Dictado cancelado.'
    default:
      return `Error de voz: ${errorCode || 'unknown'}`
  }
}

export interface StartRecognitionOptions {
  lang?: string
  onFinalText: (text: string) => void
  onError?: (message: string) => void
  onEnd?: () => void
}

export interface RecognitionController {
  stop: () => void
}

export function startSpeechRecognition(options: StartRecognitionOptions): RecognitionController {
  const Ctor = getSpeechRecognitionCtor()
  if (!Ctor) throw new Error('Reconocimiento de voz no soportado en este entorno.')

  const recognition = new Ctor()
  recognition.lang = options.lang || DEFAULT_LANG
  recognition.continuous = false
  recognition.interimResults = true
  recognition.maxAlternatives = 1

  recognition.onresult = (event) => {
    const finalText: string[] = []
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const maybe = event.results[i]?.[0]?.transcript || ''
      if (maybe.trim()) finalText.push(maybe)
    }

    const merged = finalText.join(' ').trim()
    if (merged) options.onFinalText(merged)
  }

  recognition.onerror = (event) => {
    const err = event?.error || 'unknown'
    options.onError?.(mapRecognitionError(err))
  }

  recognition.onend = () => {
    options.onEnd?.()
  }

  recognition.start()

  return {
    stop: () => recognition.stop(),
  }
}

export function speakText(text: string, options?: { lang?: string; rate?: number; pitch?: number; voiceName?: string }): void {
  if (!isSpeechSynthesisSupported()) return

  const clean = sanitizeForSpeech(text)
  if (!clean) return

  const utterance = new SpeechSynthesisUtterance(clean)
  utterance.lang = options?.lang || DEFAULT_LANG
  utterance.rate = options?.rate ?? 1
  utterance.pitch = options?.pitch ?? 1
  const voice = resolveVoice(utterance.lang, options?.voiceName)
  if (voice) utterance.voice = voice
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking(): void {
  if (!isSpeechSynthesisSupported()) return
  window.speechSynthesis.cancel()
}
