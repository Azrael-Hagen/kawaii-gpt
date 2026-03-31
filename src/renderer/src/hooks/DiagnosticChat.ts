// DiagnosticChat.ts
// Utilidad para chats de diagnóstico automáticos y temporales
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useEffect, useRef } from 'react'

export function useDiagnosticChat() {
  const { create, remove, addMessage, updateMessage } = useChatStore()
  const { settings } = useSettingsStore()
  const diagChatId = useRef<string | null>(null)

  // Crea un chat de diagnóstico temporal
  function startDiagnostic(title = '🛠️ Diagnóstico') {
    if (diagChatId.current) remove(diagChatId.current)
    diagChatId.current = create(settings.defaultModel || 'auto-smart', title)
    return diagChatId.current
  }

  // Agrega mensaje de log
  function log(msg: string) {
    if (!diagChatId.current) return
    addMessage(diagChatId.current, {
      role: 'assistant',
      content: `[DIAG] ${msg}`,
      timestamp: Date.now(),
    })
  }

  // Borra el chat de diagnóstico
  function endDiagnostic() {
    if (diagChatId.current) {
      remove(diagChatId.current)
      diagChatId.current = null
    }
  }

  // Limpieza automática al desmontar
  useEffect(() => endDiagnostic, [])

  return { startDiagnostic, log, endDiagnostic }
}
