import { User, Bot, Copy, ImageIcon, Volume2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '@/types'
import { formatTime } from '@/utils/formatters'
import { useSettingsStore } from '@/store/settingsStore'
import { useVoiceOutput } from '@/hooks/useVoiceOutput'

interface Props {
  message: Message
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user'
  const { settings } = useSettingsStore()
  const { speak } = useVoiceOutput(settings)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
    } catch {
      // ignore clipboard errors
    }
  }

  if (isUser) {
    return (
      <div className="flex justify-end animate-slide-up group">
        <div className="max-w-[80%] rounded-2xl px-4 py-3 user-bubble-bg text-white shadow-lg relative">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
          <div className="flex items-center justify-end gap-1 mt-1.5 text-[10px] text-white/70">
            <User size={10} />
            <span>{formatTime(message.timestamp)}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 items-start animate-slide-up group">
      <div className="w-8 h-8 rounded-full bg-kawaii-surface-3 flex items-center justify-center text-kawaii-purple flex-shrink-0 mt-0.5">
        {message.imageUrl ? <ImageIcon size={16} /> : <Bot size={16} />}
      </div>
      <div className="max-w-[85%] bg-kawaii-surface border border-kawaii-surface-3 rounded-2xl px-4 py-3 shadow-md relative">
        <button
          onClick={onCopy}
          className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 p-1 rounded text-kawaii-muted hover:text-kawaii-pink hover:bg-kawaii-surface-2 transition-all"
          title="Copiar"
        >
          <Copy size={12} />
        </button>

        {settings.voiceOutputEnabled && message.content && (
          <button
            onClick={() => { void speak(message.content) }}
            className="absolute right-8 top-2 opacity-0 group-hover:opacity-100 p-1 rounded text-kawaii-muted hover:text-kawaii-teal hover:bg-kawaii-surface-2 transition-all"
            title="Leer en voz alta"
          >
            <Volume2 size={12} />
          </button>
        )}

        {/* Text content */}
        {message.content && (
          <div className="prose-kawaii text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || '...'}</ReactMarkdown>
          </div>
        )}

        {/* Generated image */}
        {message.imageUrl && (
          <div className="mt-3">
            <img
              src={message.imageUrl}
              alt="Imagen generada"
              className="rounded-xl max-w-full border border-kawaii-surface-3 shadow-lg"
              style={{ maxHeight: 480 }}
            />
          </div>
        )}

        <div className="flex items-center justify-between mt-2 pt-2 border-t border-kawaii-surface-3/50 text-[10px] text-kawaii-dim">
          <div className="flex items-center gap-1.5">
            <Bot size={10} />
            <span>KawaiiGPT</span>
            {message.routeInfo && (
              <>
                <span className="opacity-40">·</span>
                <span className="text-kawaii-purple/80">{message.routeInfo}</span>
              </>
            )}
          </div>
          <span>{formatTime(message.timestamp)}</span>
        </div>
      </div>
    </div>
  )
}
