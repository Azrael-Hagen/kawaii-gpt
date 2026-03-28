import { Minus, Square, X } from 'lucide-react'
import { ConnectionStatus } from '@/hooks/useModels'

interface TitleBarProps {
  onSettingsOpen: () => void
  status: ConnectionStatus
}

const statusColors: Record<ConnectionStatus, string> = {
  checking:     'bg-kawaii-dim',
  connected:    'bg-kawaii-success',
  disconnected: 'bg-kawaii-error',
}

const statusLabels: Record<ConnectionStatus, string> = {
  checking:     'Verificando…',
  connected:    'IA conectada',
  disconnected: 'IA desconectada',
}

export default function TitleBar({ onSettingsOpen, status }: TitleBarProps) {
  const minimize = () => window.api?.minimize()
  const maximize = () => window.api?.maximize()
  const close    = () => window.api?.close()

  return (
    <div className="drag-region flex items-center justify-between h-11 px-4 bg-kawaii-surface border-b border-kawaii-surface-3 flex-shrink-0 select-none">
      {/* Left — branding */}
      <div className="flex items-center gap-2 no-drag">
        <span className="text-lg leading-none">🌸</span>
        <span className="font-extrabold text-sm gradient-text tracking-wide">KawaiiGPT</span>
      </div>

      {/* Center — AI status */}
      <div className="flex items-center gap-1.5 no-drag cursor-pointer group" onClick={onSettingsOpen} title={statusLabels[status]}>
        <span className={`w-2 h-2 rounded-full ${statusColors[status]} ${status === 'checking' ? 'animate-pulse-slow' : ''}`} />
        <span className="text-kawaii-muted text-xs group-hover:text-kawaii-text transition-colors">
          {statusLabels[status]}
        </span>
      </div>

      {/* Right — window controls */}
      <div className="flex items-center gap-1 no-drag">
        <button
          onClick={onSettingsOpen}
          className="px-2 py-1 text-kawaii-muted hover:text-kawaii-pink text-xs font-semibold transition-colors"
          title="Ajustes"
        >
          ⚙️
        </button>
        <WindowBtn onClick={minimize} title="Minimize"><Minus size={12} /></WindowBtn>
        <WindowBtn onClick={maximize} title="Maximize"><Square size={11} /></WindowBtn>
        <WindowBtn onClick={close}    title="Close"    danger><X size={12} /></WindowBtn>
      </div>
    </div>
  )
}

function WindowBtn({ onClick, title, danger, children }: {
  onClick: () => void
  title: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-7 h-7 rounded-md flex items-center justify-center text-kawaii-muted transition-colors
        ${danger ? 'hover:bg-kawaii-error hover:text-white' : 'hover:bg-kawaii-surface-3 hover:text-kawaii-text'}`}
    >
      {children}
    </button>
  )
}
