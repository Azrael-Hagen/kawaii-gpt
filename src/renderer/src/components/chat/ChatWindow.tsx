import { useEffect, useRef } from 'react'
import type { Message } from '@/types'

interface Props {
  messages: Message[]
  isLoading: boolean
  convId?: string // conversation id for per-message actions
  debugMode?: boolean
}
import MessageBubble from './MessageBubble'
import TypingIndicator from './TypingIndicator'
import { useSettingsStore } from '@/store/settingsStore'
import { useVoiceOutput } from '@/hooks/useVoiceOutput'



const ChatWindow = ({ messages, isLoading, convId, debugMode }: Props) => {
  const bottomRef = useRef<HTMLDivElement>(null)
  const hydratedRef = useRef(false)
  const { settings } = useSettingsStore()
  const { autoSpeakOnce, markAsSpoken } = useVoiceOutput(settings)
  const maxVisibleMessages = isLoading ? 140 : 220
  const visibleMessages = messages.length > maxVisibleMessages
    ? messages.slice(-maxVisibleMessages)
    : messages

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: isLoading ? 'auto' : 'smooth', block: 'end' })
  }, [messages, isLoading])

  useEffect(() => {
    if (isLoading) return
    let latestAssistant: Message | undefined
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const candidate = messages[i]
      if (candidate.role === 'assistant' && !candidate.isStreaming && Boolean(candidate.content?.trim())) {
        latestAssistant = candidate
        break
      }
    }
    if (!latestAssistant) return

    if (!hydratedRef.current) {
      hydratedRef.current = true
      markAsSpoken(latestAssistant.id)
      return
    }

    if (!settings.voiceOutputEnabled || !settings.voiceAutoPlayResponses) return
    void autoSpeakOnce(latestAssistant.id, latestAssistant.content)
  }, [messages, isLoading, settings.voiceAutoPlayResponses, settings.voiceOutputEnabled, autoSpeakOnce, markAsSpoken])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-kawaii-bg">
        {Boolean(debugMode) && (
          <div className="w-full max-w-4xl mb-4 p-3 rounded-lg border border-yellow-400 bg-yellow-50 text-yellow-900 text-xs shadow animate-fade-in">
            <b>Diagnóstico:</b> Provider: <b>{settings.provider}</b> | Model: <b>{settings.defaultModel || settings.localModel || settings.cloudModel || settings.legacyModel || '(no model)'}</b>
            {settings.provider === 'openai-compatible' && (<span> | Endpoint: <b>{settings.cloudBaseUrl}</b></span>)}
            {settings.provider === 'ollama' && (<span> | Endpoint: <b>{settings.localBaseUrl}</b></span>)}
            {settings.provider === 'legacy-engine' && (<span> | Endpoint: <b>{settings.legacyEngineBaseUrl}</b></span>)}
          </div>
        )}
        <div className="max-w-xl text-center animate-fade-in">
          <div className="text-6xl mb-4">🌸</div>
          <h1 className="text-3xl font-extrabold mb-3 gradient-text">Bienvenido a KawaiiGPT</h1>
          <p className="text-kawaii-muted text-sm leading-relaxed">
            Tu asistente de IA sin restricciones, con acceso a múltiples IAs gratuitas.
            <br />
            Pregunta lo que quieras — sin filtros, sin límites.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs">
            {[
              'Explícame este código 🧠',
              'Escribe un blog post ✍️',
              'Traduce este texto 🌍',
              'Planifica mi proyecto 📋',
              'Dibuja una imagen 🎨',
              'Busca en internet 🔍',
            ].map(item => (
              <span key={item} className="px-3 py-1.5 rounded-full bg-kawaii-surface text-kawaii-muted border border-kawaii-surface-3">
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-kawaii-bg px-6 py-4">
      {Boolean(debugMode) && (
        <div className="w-full max-w-4xl mb-4 p-3 rounded-lg border border-yellow-400 bg-yellow-50 text-yellow-900 text-xs shadow animate-fade-in">
          <b>Diagnóstico:</b> Provider: <b>{settings.provider}</b> | Model: <b>{settings.defaultModel || settings.localModel || settings.cloudModel || settings.legacyModel || '(no model)'}</b>
          {settings.provider === 'openai-compatible' && (<span> | Endpoint: <b>{settings.cloudBaseUrl}</b></span>)}
          {settings.provider === 'ollama' && (<span> | Endpoint: <b>{settings.localBaseUrl}</b></span>)}
          {settings.provider === 'legacy-engine' && (<span> | Endpoint: <b>{settings.legacyEngineBaseUrl}</b></span>)}
        </div>
      )}
      <div className="max-w-4xl mx-auto space-y-4">
        {messages.length > visibleMessages.length && (
          <div className="rounded-lg border border-kawaii-surface-3 bg-kawaii-surface px-3 py-2 text-xs text-kawaii-dim">
            Modo fluido activo: mostrando {visibleMessages.length} de {messages.length} mensajes para mantener el chat responsivo.
          </div>
        )}
        {visibleMessages.map((msg: Message) => (
          <MessageBubble key={msg.id} message={msg} convId={convId} />
        ))}
        {isLoading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

export default ChatWindow
