import { memo } from 'react'
import { User, Bot, Copy, FileText, ImageIcon, Volume2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '@/types'
import { formatDateTimeLong, formatFileSize } from '@/utils/formatters'
import { useSettingsStore } from '@/store/settingsStore'
import { useVoiceOutput } from '@/hooks/useVoiceOutput'


interface Props {
  message: Message
  convId?: string // for per-message actions
}

import { useChatStore } from '@/store/chatStore'

function MessageBubbleBase({ message, convId }: Props) {
    const { deleteMessage } = useChatStore()

    const onDelete = () => {
      if (convId && message.id) {
        deleteMessage(convId, message.id)
      }
    }
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
          {message.content && <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-3 space-y-2">
              {message.attachments.map((attachment) => (
                <AttachmentCard key={attachment.id} messageRole="user" attachment={attachment} />
              ))}
            </div>
          )}
          <div className="flex items-center justify-end gap-1 mt-1.5 text-[10px] text-white/70">
            <User size={10} />
            <span>{formatDateTimeLong(message.timestamp)}</span>
            {/* Delete button, only show on hover */}
            {convId && (
              <button
                onClick={onDelete}
                className="ml-2 opacity-0 group-hover:opacity-100 p-1 rounded text-white/60 hover:text-red-400 hover:bg-white/10 transition-all"
                title="Borrar mensaje"
              >
                ×
              </button>
            )}
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
        {/* Delete button, only show on hover */}
        {convId && (
          <button
            onClick={onDelete}
            className="absolute right-8 top-2 opacity-0 group-hover:opacity-100 p-1 rounded text-kawaii-muted hover:text-red-400 hover:bg-kawaii-surface-2 transition-all"
            title="Borrar mensaje"
          >
            ×
          </button>
        )}

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
        {message.content && message.isStreaming && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
        )}

        {message.content && !message.isStreaming && (
          <div className="prose-kawaii text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || '...'}</ReactMarkdown>
          </div>
        )}

        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.attachments.map((attachment) => (
              <AttachmentCard key={attachment.id} messageRole="assistant" attachment={attachment} />
            ))}
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
          <span>{formatDateTimeLong(message.timestamp)}</span>
        </div>
      </div>
    </div>
  )
}

const MessageBubble = memo(MessageBubbleBase)
export default MessageBubble

function AttachmentCard({
  attachment,
  messageRole,
}: {
  attachment: Message['attachments'][number]
  messageRole: 'user' | 'assistant'
}) {
  if (!attachment) return null

  const shellClass = messageRole === 'user'
    ? 'border-white/20 bg-white/10 text-white'
    : 'border-kawaii-surface-3 bg-kawaii-surface-2 text-kawaii-text'
  const mutedClass = messageRole === 'user' ? 'text-white/70' : 'text-kawaii-dim'

  return (
    <div className={`rounded-xl border px-3 py-2 ${shellClass}`}>
      <div className="flex items-center gap-2 text-xs font-medium">
        {attachment.kind === 'image' ? <ImageIcon size={13} /> : <FileText size={13} />}
        <span className="truncate">{attachment.name}</span>
        <span className={mutedClass}>{formatFileSize(attachment.size)}</span>
      </div>

      {attachment.kind === 'image' && attachment.dataUrl && (
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          className="mt-2 rounded-lg max-h-56 border border-black/10"
        />
      )}

      {attachment.kind === 'text' && (attachment.previewText || attachment.extractedText) && (
        <p className={`mt-2 whitespace-pre-wrap text-xs leading-relaxed ${mutedClass}`}>
          {attachment.previewText || attachment.extractedText}
          {attachment.isTruncated ? '…' : ''}
        </p>
      )}

      {attachment.kind === 'binary' && attachment.unsupportedReason && (
        <p className={`mt-2 text-xs leading-relaxed ${mutedClass}`}>{attachment.unsupportedReason}</p>
      )}
    </div>
  )
}
