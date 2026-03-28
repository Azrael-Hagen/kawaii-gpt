import { useCallback, useRef, useState } from 'react'
import { isSpeechRecognitionSupported, requestMicrophoneAccess, startSpeechRecognition, type RecognitionController } from '@/services/voice'

export function useVoiceInput(language: string) {
  const [isListening, setIsListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const ctrlRef = useRef<RecognitionController | null>(null)

  const start = useCallback(async (onFinalText: (text: string) => void) => {
    setVoiceError(null)

    if (!isSpeechRecognitionSupported()) {
      setVoiceError('Reconocimiento de voz no soportado por este runtime.')
      return
    }

    try {
      await requestMicrophoneAccess()
      ctrlRef.current = startSpeechRecognition({
        lang: language,
        onFinalText,
        onError: (msg) => setVoiceError(msg),
        onEnd: () => setIsListening(false),
      })
      setIsListening(true)
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
  }, [language])

  const stop = useCallback(() => {
    ctrlRef.current?.stop()
    ctrlRef.current = null
    setIsListening(false)
  }, [])

  return { isListening, voiceError, clearVoiceError: () => setVoiceError(null), start, stop }
}
