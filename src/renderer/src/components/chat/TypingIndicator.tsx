import { Bot } from 'lucide-react'

export default function TypingIndicator() {
  return (
    <div className="flex gap-3 items-start animate-fade-in">
      <div className="w-8 h-8 rounded-full bg-kawaii-surface-3 flex items-center justify-center text-kawaii-pink flex-shrink-0">
        <Bot size={16} />
      </div>
      <div className="bg-kawaii-surface border border-kawaii-surface-3 rounded-2xl px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="typing-dot w-2 h-2 rounded-full bg-kawaii-muted animate-bounce-dot" />
          <span className="typing-dot w-2 h-2 rounded-full bg-kawaii-muted animate-bounce-dot" />
          <span className="typing-dot w-2 h-2 rounded-full bg-kawaii-muted animate-bounce-dot" />
        </div>
      </div>
    </div>
  )
}
