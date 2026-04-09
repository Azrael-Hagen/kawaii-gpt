import { useEffect, useState } from 'react'
import { Plus, Trash2, MessageCircle } from 'lucide-react'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { formatRelativeDate } from '@/utils/formatters'

export default function Sidebar() {
  const { conversations, activeId, create, remove, setActive } = useChatStore()
  const { settings } = useSettingsStore()
  const [appVersion, setAppVersion] = useState('...')
  const [runtimeMode, setRuntimeMode] = useState<'dev' | 'packaged' | 'unknown'>('unknown')

  useEffect(() => {
    window.api?.getVersion?.().then(setAppVersion).catch(() => setAppVersion('dev'))
    window.api?.getRuntimeMode?.().then(setRuntimeMode).catch(() => setRuntimeMode('unknown'))
  }, [])

  const handleNew = () => {
    const model = settings.defaultModel
    if (model) create(model)
  }

  // Group conversations by relative date
  const groups = groupByDate(conversations)

  return (
    <aside className="w-64 flex flex-col bg-kawaii-surface border-r border-kawaii-surface-3 flex-shrink-0 h-full">
      {/* New chat button */}
      <div className="p-3 border-b border-kawaii-surface-3">
        <button
          onClick={handleNew}
          disabled={!settings.defaultModel}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl
            bg-gradient-to-r from-kawaii-pink to-kawaii-purple text-white font-bold text-sm
            hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={16} />
          Nueva conversación
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
        {conversations.length === 0 ? (
          <div className="text-center text-kawaii-dim text-xs py-8 leading-relaxed">
            <MessageCircle className="mx-auto mb-2 opacity-40" size={24} />
            Sin conversaciones aún.<br />¡Empieza una nueva! 🌸
          </div>
        ) : (
          groups.map(({ label, items }) => (
            <div key={label}>
              <p className="text-kawaii-dim text-xs font-semibold px-2 py-1.5 uppercase tracking-wider">
                {label}
              </p>
              {items.map(conv => (
                <ConversationItem
                  key={conv.id}
                  title={conv.title}
                  isActive={conv.id === activeId}
                  onSelect={() => setActive(conv.id)}
                  onDelete={(e) => { e.stopPropagation(); remove(conv.id) }}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-kawaii-surface-3">
        <p className="text-kawaii-dim text-xs text-center">
          KawaiiGPT ✨ v{appVersion} [{runtimeMode.toUpperCase()}]
        </p>
      </div>
    </aside>
  )
}

function ConversationItem({
  title, isActive, onSelect, onDelete,
}: {
  title: string
  isActive: boolean
  onSelect: () => void
  onDelete: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-all
        ${isActive
          ? 'bg-kawaii-surface-3 text-kawaii-text'
          : 'text-kawaii-muted hover:bg-kawaii-surface-2 hover:text-kawaii-text'
        }`}
    >
      <MessageCircle size={14} className="flex-shrink-0 opacity-60" />
      <span className="flex-1 text-sm truncate">{title}</span>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-kawaii-error transition-all"
        title="Eliminar"
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface Group {
  label: string
  items: ReturnType<typeof useChatStore.getState>['conversations']
}

function groupByDate(conversations: ReturnType<typeof useChatStore.getState>['conversations']): Group[] {
  const map = new Map<string, typeof conversations>()
  for (const conv of conversations) {
    const label = formatRelativeDate(conv.updatedAt)
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(conv)
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }))
}
