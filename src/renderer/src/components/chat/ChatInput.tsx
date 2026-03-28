import { useState } from 'react'
import { Mic, MicOff, Send, Square } from 'lucide-react'
import type { AIModel } from '@/types'
import { useSettingsStore } from '@/store/settingsStore'
import { useVoiceInput } from '@/hooks/useVoiceInput'

interface Props {
  models: AIModel[]
  selectedModel: string
  smartMode?: boolean
  onModelChange: (model: string) => void
  onSend: (message: string) => void
  onStop: () => void
  isLoading: boolean
}

export default function ChatInput({ models, selectedModel, smartMode = false, onModelChange, onSend, onStop, isLoading }: Props) {
  const [input, setInput] = useState('')
  const { settings } = useSettingsStore()
  const { isListening, voiceError, clearVoiceError, start, stop } = useVoiceInput(settings.voiceLanguage)

  const handleSubmit = () => {
    if (!input.trim() || (!selectedModel && !smartMode) || isLoading) return
    onSend(input)
    setInput('')
  }

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const canSend = Boolean(input.trim() && (selectedModel || smartMode) && !isLoading)

  const onVoiceToggle = () => {
    if (isListening) {
      stop()
      return
    }

    start((text) => {
      const merged = [input.trim(), text.trim()].filter(Boolean).join(' ').trim()
      if (!merged) return

      if (settings.voiceAutoSend && !isLoading && (selectedModel || smartMode)) {
        onSend(merged)
        setInput('')
      } else {
        setInput(merged)
      }
    }).catch(() => {
      // Error surfaced by hook state.
    })
  }

  return (
    <div className="border-t border-kawaii-surface-3 bg-kawaii-surface p-4 flex-shrink-0">
      <div className="max-w-4xl mx-auto space-y-2">
        {/* Automatic model management status */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-kawaii-muted">Modelo:</span>
          <span className="px-2.5 py-1 rounded-lg border border-kawaii-teal/40 bg-kawaii-teal/10 text-kawaii-teal">
            {smartMode
              ? 'Auto inteligente (Mini IA de ruteo)'
              : selectedModel
                ? `Auto (${selectedModel})`
                : 'Auto (configura un modelo en Ajustes)'}
          </span>
        </div>

        {/* Input box */}
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={smartMode || selectedModel ? 'Escríbeme algo...' : 'Selecciona un modelo en Ajustes ⚙️'}
              rows={1}
              className="w-full resize-none bg-kawaii-surface-2 border border-kawaii-surface-3 rounded-2xl px-4 py-3 pr-12
                text-kawaii-text placeholder-kawaii-dim text-sm leading-relaxed
                focus:outline-none focus:border-kawaii-pink focus:ring-2 focus:ring-kawaii-pink/20"
              style={{ minHeight: 48, maxHeight: 160 }}
              disabled={(!selectedModel && !smartMode) || isLoading}
            />

            <div className="absolute right-3 bottom-2 text-[10px] text-kawaii-dim">
              Enter ↵ · Shift+Enter nueva línea
            </div>
          </div>

          {settings.voiceInputEnabled && !isLoading && (
            <button
              onClick={onVoiceToggle}
              className={`w-11 h-11 rounded-xl border flex items-center justify-center transition-all active:scale-95 ${
                isListening
                  ? 'bg-kawaii-error text-white border-kawaii-error'
                  : 'bg-kawaii-surface-2 text-kawaii-text border-kawaii-surface-3 hover:bg-kawaii-surface-3'
              }`}
              title={isListening ? 'Detener dictado' : 'Iniciar dictado por voz'}
            >
              {isListening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
          )}

          {isLoading ? (
            <button
              onClick={onStop}
              className="w-11 h-11 rounded-xl bg-kawaii-error text-white flex items-center justify-center
                hover:opacity-90 active:scale-95 transition-all"
              title="Detener generación"
            >
              <Square size={15} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canSend}
              className="w-11 h-11 rounded-xl bg-gradient-to-r from-kawaii-pink to-kawaii-purple text-white
                flex items-center justify-center hover:opacity-90 active:scale-95 transition-all
                disabled:opacity-40 disabled:cursor-not-allowed"
              title="Send"
            >
              <Send size={16} />
            </button>
          )}
        </div>

        {voiceError && (
          <div className="flex items-center justify-between text-xs text-kawaii-error bg-kawaii-error/10 border border-kawaii-error/30 rounded-lg px-2.5 py-1.5">
            <span>{voiceError}</span>
            <button type="button" onClick={clearVoiceError} className="underline">Cerrar</button>
          </div>
        )}
      </div>
    </div>
  )
}
