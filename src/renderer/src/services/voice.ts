const DEFAULT_LANG = 'es-ES'
const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts'
const OPENAI_STT_MODEL = 'gpt-4o-mini-transcribe'
const RECORDING_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

let activeAudio: HTMLAudioElement | null = null

export interface AvailableVoice {
  name: string
  lang: string
  default: boolean
}

export interface SpeakOptions {
  lang?: string
  rate?: number
  pitch?: number
  voiceName?: string
}

export interface RecognitionError {
  code?: string
  message: string
}

export interface VoicePlaybackResult {
  engine: 'system' | 'openai'
  requestedVoice: string
  resolvedVoice: string
}

export interface CloudTtsOptions {
  baseUrl: string
  apiKey: string
  text: string
  lang?: string
  voice?: string
  instructions?: string
}

export interface CloudTranscriptionOptions {
  baseUrl: string
  apiKey: string
  audio: Blob
  lang?: string
  prompt?: string
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

export function pickCloudVoiceForLanguage(language: string, preferred?: string): string {
  if (preferred?.trim()) return preferred.trim()
  const lower = language.toLowerCase()
  if (lower.startsWith('es')) return 'marin'
  if (lower.startsWith('en')) return 'cedar'
  return 'marin'
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

export function getResolvedSystemVoiceName(lang: string, preferredName?: string): string {
  return resolveVoice(lang, preferredName)?.name ?? ''
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
    case 'language-not-supported':
      return 'El motor de voz del navegador no soporta este idioma.'
    default:
      return `Error de voz: ${errorCode || 'unknown'}`
  }
}

function compactErrorText(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  return RECORDING_MIME_CANDIDATES.find(type => MediaRecorder.isTypeSupported(type)) ?? ''
}

function getRecordingExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}

export function normalizeTranscriptionLanguage(language: string): string {
  return language.split('-')[0]?.toLowerCase() || 'es'
}

export function shouldFallbackRecognitionErrorToCloud(errorCode?: string): boolean {
  switch ((errorCode || '').toLowerCase()) {
    case 'network':
    case 'service-not-allowed':
    case 'language-not-supported':
      return true
    default:
      return false
  }
}

export function isAudioRecordingSupported(): boolean {
  return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined'
}

export interface StartRecognitionOptions {
  lang?: string
  onFinalText: (text: string) => void
  onError?: (error: RecognitionError) => void
  onEnd?: () => void
}

export interface RecognitionController {
  stop: () => void
}

export interface RecordingController {
  stop: () => void
}

export interface StartAudioRecordingOptions {
  onFinalAudio: (audio: Blob) => Promise<void> | void
  onError?: (message: string) => void
  onEnd?: () => void
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
    options.onError?.({ code: err, message: mapRecognitionError(err) })
  }

  recognition.onend = () => {
    options.onEnd?.()
  }

  recognition.start()

  return {
    stop: () => recognition.stop(),
  }
}

export async function startAudioRecording(options: StartAudioRecordingOptions): Promise<RecordingController> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Grabacion de audio no disponible en este runtime.')
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Grabacion de audio no soportada por este runtime.')
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = pickRecordingMimeType()
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
  const chunks: Blob[] = []
  let finished = false

  const finalize = () => {
    if (finished) return
    finished = true
    for (const track of stream.getTracks()) track.stop()
    options.onEnd?.()
  }

  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data)
  }

  recorder.onerror = () => {
    options.onError?.('No se pudo grabar audio para dictado cloud.')
    finalize()
  }

  recorder.onstop = () => {
    void (async () => {
      try {
        const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' })
        if (!audio.size) {
          options.onError?.('No se capturo audio del microfono.')
          return
        }
        await options.onFinalAudio(audio)
      } catch (err) {
        options.onError?.(err instanceof Error ? err.message : String(err))
      } finally {
        finalize()
      }
    })()
  }

  recorder.start()

  return {
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop()
    },
  }
}

export function speakText(text: string, options?: { lang?: string; rate?: number; pitch?: number; voiceName?: string }): VoicePlaybackResult | null {
  if (!isSpeechSynthesisSupported()) return null

  const clean = sanitizeForSpeech(text)
  if (!clean) return null

  const utterance = new SpeechSynthesisUtterance(clean)
  utterance.lang = options?.lang || DEFAULT_LANG
  utterance.rate = options?.rate ?? 1
  utterance.pitch = options?.pitch ?? 1
  const voice = resolveVoice(utterance.lang, options?.voiceName)
  if (voice) utterance.voice = voice
  window.speechSynthesis.cancel()
  if (activeAudio) {
    activeAudio.pause()
    activeAudio = null
  }
  window.speechSynthesis.speak(utterance)
  return {
    engine: 'system',
    requestedVoice: options?.voiceName || '',
    resolvedVoice: utterance.voice?.name || '',
  }
}

export async function speakTextWithOpenAI(options: CloudTtsOptions): Promise<VoicePlaybackResult> {
  const clean = sanitizeForSpeech(options.text)
  const selectedVoice = pickCloudVoiceForLanguage(options.lang || DEFAULT_LANG, options.voice)
  if (!clean) {
    return {
      engine: 'openai',
      requestedVoice: options.voice || '',
      resolvedVoice: selectedVoice,
    }
  }

  const res = await fetch(`${options.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: selectedVoice,
      input: clean,
      instructions: options.instructions || 'Speak naturally, warm, and fluid. Avoid robotic pacing.',
      format: 'mp3',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Cloud voice error (${res.status}): ${text}`)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  activeAudio = audio
  window.speechSynthesis.cancel()
  await audio.play()
  audio.onended = () => {
    URL.revokeObjectURL(url)
    if (activeAudio === audio) activeAudio = null
  }
  return {
    engine: 'openai',
    requestedVoice: options.voice || '',
    resolvedVoice: selectedVoice,
  }
}

export async function transcribeAudioWithOpenAI(options: CloudTranscriptionOptions): Promise<string> {
  const fileType = options.audio.type || 'audio/webm'
  const file = new File([options.audio], `speech.${getRecordingExtension(fileType)}`, { type: fileType })
  const form = new FormData()
  form.set('file', file)
  form.set('model', OPENAI_STT_MODEL)
  form.set('response_format', 'json')
  form.set('language', normalizeTranscriptionLanguage(options.lang || DEFAULT_LANG))
  if (options.prompt?.trim()) form.set('prompt', options.prompt.trim())

  const res = await fetch(`${options.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: form,
  })

  if (!res.ok) {
    const raw = await res.text()
    throw new Error(`Cloud dictation error (${res.status}): ${compactErrorText(raw) || 'respuesta invalida del proveedor.'}`)
  }

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const data = await res.json() as { text?: string }
    return data.text?.trim() ?? ''
  }

  return (await res.text()).trim()
}

export function stopSpeaking(): void {
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel()
  }
  if (activeAudio) {
    activeAudio.pause()
    activeAudio = null
  }
}
