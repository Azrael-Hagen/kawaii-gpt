import { useCallback, useRef } from 'react'
import { detectCloudProvider } from '@/services/cloudCatalog'
import { isSpeechSynthesisSupported, speakText, speakTextWithOpenAI, stopSpeaking } from '@/services/voice'
import type { Settings } from '@/types'
import { getAdditionalProviderKey, getProviderApiKey } from '@/utils/secureSettings'

async function resolveBestVoiceTarget(settings: Settings): Promise<
  | { kind: 'openai'; baseUrl: string; apiKey: string }
  | { kind: 'system' }
> {
  if (settings.voiceOutputMode === 'system') return { kind: 'system' }

  const mainKey = await getProviderApiKey()
  if (mainKey.trim() && detectCloudProvider(settings.cloudBaseUrl) === 'openai') {
    return { kind: 'openai', baseUrl: settings.cloudBaseUrl, apiKey: mainKey }
  }

  for (const ap of settings.additionalProviders ?? []) {
    if (!ap.enabled || detectCloudProvider(ap.baseUrl) !== 'openai') continue
    const key = await getAdditionalProviderKey(ap.id)
    if (key.trim()) {
      return { kind: 'openai', baseUrl: ap.baseUrl, apiKey: key }
    }
  }

  return { kind: 'system' }
}

export function useVoiceOutput(settings: Settings) {
  const lastSpokenIdRef = useRef<string | null>(null)

  const speak = useCallback(async (text: string) => {
    const target = await resolveBestVoiceTarget(settings)
    if (target.kind === 'openai') {
      try {
        await speakTextWithOpenAI({
          baseUrl: target.baseUrl,
          apiKey: target.apiKey,
          text,
          lang: settings.voiceLanguage,
          voice: settings.voiceCloudVoice,
        })
        return
      } catch {
        // Fall through to system TTS.
      }
    }

    if (!isSpeechSynthesisSupported()) return
    speakText(text, {
      lang: settings.voiceLanguage,
      rate: settings.voiceRate,
      pitch: settings.voicePitch,
      voiceName: settings.voiceName,
    })
  }, [settings])

  const autoSpeakOnce = useCallback(async (messageId: string, text: string) => {
    if (lastSpokenIdRef.current === messageId) return
    if (text.trim().startsWith('⚠️')) return
    lastSpokenIdRef.current = messageId
    await speak(text)
  }, [speak])

  return {
    isSupported: isSpeechSynthesisSupported(),
    speak,
    stop: stopSpeaking,
    autoSpeakOnce,
  }
}
