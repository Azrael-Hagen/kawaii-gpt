import { useCallback, useRef, useState } from 'react'
import { detectCloudProvider } from '@/services/cloudCatalog'
import {
  isAudioRecordingSupported,
  isSpeechRecognitionSupported,
  requestMicrophoneAccess,
  shouldFallbackRecognitionErrorToCloud,
  startAudioRecording,
  startSpeechRecognition,
  transcribeAudioWithOpenAI,
  type RecognitionController,
  type RecordingController,
} from '@/services/voice'
import type { Settings } from '@/types'
import { getAdditionalProviderKey, getProviderApiKey } from '@/utils/secureSettings'

async function resolveCloudTranscriptionTarget(settings: Settings): Promise<{ baseUrl: string; apiKey: string } | null> {
  const mainKey = await getProviderApiKey()
  if (mainKey.trim() && detectCloudProvider(settings.cloudBaseUrl) === 'openai') {
    return { baseUrl: settings.cloudBaseUrl, apiKey: mainKey.trim() }
  }

  for (const ap of settings.additionalProviders ?? []) {
    if (!ap.enabled || detectCloudProvider(ap.baseUrl) !== 'openai') continue
    const key = await getAdditionalProviderKey(ap.id)
    if (key.trim()) {
      return { baseUrl: ap.baseUrl, apiKey: key.trim() }
    }
  }

  return null
}

export function useVoiceInput(settings: Settings) {
  const [isListening, setIsListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const recognitionRef = useRef<RecognitionController | null>(null)
  const recorderRef = useRef<RecordingController | null>(null)
  const modeRef = useRef<'idle' | 'browser' | 'cloud' | 'transition'>('idle')

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    recorderRef.current?.stop()
    recognitionRef.current = null
    recorderRef.current = null
    modeRef.current = 'idle'
    setIsListening(false)
  }, [])

  const startCloudSession = useCallback(async (
    target: { baseUrl: string; apiKey: string },
    onFinalText: (text: string) => void,
  ) => {
    if (!isAudioRecordingSupported()) {
      setVoiceError('Grabacion de audio no soportada por este runtime.')
      setIsListening(false)
      return
    }

    modeRef.current = 'cloud'
    recorderRef.current = await startAudioRecording({
      onFinalAudio: async (audio) => {
        const text = await transcribeAudioWithOpenAI({
          baseUrl: target.baseUrl,
          apiKey: target.apiKey,
          audio,
          lang: settings.voiceLanguage,
          prompt: 'Transcribe con puntuacion natural y conserva el idioma original.',
        })
        if (!text.trim()) {
          throw new Error('No se detecto voz en la grabacion.')
        }
        onFinalText(text.trim())
      },
      onError: (msg) => setVoiceError(msg),
      onEnd: () => {
        recorderRef.current = null
        modeRef.current = 'idle'
        setIsListening(false)
      },
    })
    setIsListening(true)
  }, [settings.voiceLanguage])

  const startBrowserSession = useCallback(async (
    onFinalText: (text: string) => void,
    cloudTarget: { baseUrl: string; apiKey: string } | null,
    allowFallback: boolean,
  ) => {
    await requestMicrophoneAccess()
    modeRef.current = 'browser'
    recognitionRef.current = startSpeechRecognition({
      lang: settings.voiceLanguage,
      onFinalText,
      onError: (error) => {
        if (allowFallback && cloudTarget && shouldFallbackRecognitionErrorToCloud(error.code)) {
          modeRef.current = 'transition'
          recognitionRef.current?.stop()
          recognitionRef.current = null
          void startCloudSession(cloudTarget, onFinalText)
          return
        }
        setVoiceError(error.message)
      },
      onEnd: () => {
        recognitionRef.current = null
        if (modeRef.current === 'browser') {
          modeRef.current = 'idle'
          setIsListening(false)
        }
      },
    })
    setIsListening(true)
  }, [settings.voiceLanguage, startCloudSession])

  const start = useCallback(async (onFinalText: (text: string) => void) => {
    setVoiceError(null)

    try {
      const cloudTarget = await resolveCloudTranscriptionTarget(settings)

      if (settings.voiceInputMode === 'cloud') {
        if (!cloudTarget) {
          setVoiceError('No hay un proveedor OpenAI configurado para dictado cloud.')
          return
        }
        await startCloudSession(cloudTarget, onFinalText)
        return
      }

      if (settings.voiceInputMode === 'browser') {
        if (!isSpeechRecognitionSupported()) {
          setVoiceError('Reconocimiento de voz no soportado por este runtime.')
          return
        }
        await startBrowserSession(onFinalText, null, false)
        return
      }

      if (isSpeechRecognitionSupported()) {
        await startBrowserSession(onFinalText, cloudTarget, Boolean(cloudTarget))
        return
      }

      if (cloudTarget) {
        await startCloudSession(cloudTarget, onFinalText)
        return
      }

      setVoiceError('No hay un motor de dictado disponible en este runtime ni un proveedor cloud compatible configurado.')
    } catch (err) {
      const msg = err instanceof DOMException
        ? err.name === 'NotAllowedError'
          ? 'Micrófono bloqueado. Habilita permisos para la app.'
          : err.name === 'NotFoundError'
            ? 'No se encontró un micrófono disponible.'
            : err.message
        : err instanceof Error
          ? err.message
          : String(err)
      setVoiceError(msg)
      setIsListening(false)
    }
  }, [settings, startBrowserSession, startCloudSession])

  return { isListening, voiceError, clearVoiceError: () => setVoiceError(null), start, stop }
}
