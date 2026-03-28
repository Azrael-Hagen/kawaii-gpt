import { useCallback, useRef } from 'react'
import { isSpeechSynthesisSupported, speakText, stopSpeaking } from '@/services/voice'

export function useVoiceOutput(language: string, rate: number, pitch: number, voiceName: string) {
  const lastSpokenIdRef = useRef<string | null>(null)

  const speak = useCallback((text: string) => {
    if (!isSpeechSynthesisSupported()) return
    speakText(text, { lang: language, rate, pitch, voiceName })
  }, [language, rate, pitch, voiceName])

  const autoSpeakOnce = useCallback((messageId: string, text: string) => {
    if (!isSpeechSynthesisSupported()) return
    if (lastSpokenIdRef.current === messageId) return
    if (text.trim().startsWith('⚠️')) return
    lastSpokenIdRef.current = messageId
    speakText(text, { lang: language, rate, pitch, voiceName })
  }, [language, rate, pitch, voiceName])

  return {
    isSupported: isSpeechSynthesisSupported(),
    speak,
    stop: stopSpeaking,
    autoSpeakOnce,
  }
}
