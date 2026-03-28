import { useEffect, useRef } from 'react'
import type { Message } from '@/types'
import MessageBubble from './MessageBubble'
import TypingIndicator from './TypingIndicator'
import { useSettingsStore } from '@/store/settingsStore'
import { useVoiceOutput } from '@/hooks/useVoiceOutput'

interface Props {
  messages: Message[]
  isLoading: boolean
}

export default function ChatWindow({ messages, isLoading }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const { settings } = useSettingsStore()
  const { autoSpeakOnce } = useVoiceOutput(settings)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  useEffect(() => {
    if (!settings.voiceOutputEnabled) return
    const latestAssistant = [...messages]
      .reverse()
      .find(m => m.role === 'assistant' && !m.isStreaming && Boolean(m.content?.trim()))
    if (!latestAssistant) return
    void autoSpeakOnce(latestAssistant.id, latestAssistant.content)
  }, [messages, settings.voiceOutputEnabled, autoSpeakOnce])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 bg-kawaii-bg">
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
      <div className="max-w-4xl mx-auto space-y-4">
        {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
        {isLoading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
