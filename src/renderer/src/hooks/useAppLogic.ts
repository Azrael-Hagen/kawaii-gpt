import { useEffect, useMemo, useState } from 'react'
import { useDiagnosticsStore } from '@/diagnostics/diagnosticsStore'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useChat } from '@/hooks/useChat'
import { useModels } from '@/hooks/useModels'
import { appendErrorLog, createErrorLogEntry, updateErrorKnowledgeBase } from '@/services/errorDiagnostics'
import { clearChatTraces, getRecentChatTraces, summarizeChatTrace } from '@/services/chatTrace'

export function useAppLogic() {
  const [showSettings, setShowSettings] = useState(false)
  const { settings: appSettings, update } = useSettingsStore()
  const [showWizard, setShowWizard] = useState(false)

  useEffect(() => {
    setShowWizard(!appSettings.hasCompletedSetup)
  }, [appSettings.hasCompletedSetup])

  const { conversations, activeId } = useChatStore()
  const activeConversation = useMemo(
    () => conversations.find(c => c.id === activeId),
    [conversations, activeId],
  )

  const { models, status, refetch } = useModels()
  const { sendMessage, stopStreaming, isLoading, error, clearError } = useChat(models)
  const debugMode = useDiagnosticsStore(s => s.debugMode)

  useEffect(() => {
    ;(window as any).__kawaiiChatDebug = {
      getRecentTraces: (limit = 20) => getRecentChatTraces(limit),
      getRecentTraceSummaries: (limit = 10) => getRecentChatTraces(limit).map(summarizeChatTrace),
      clearTraces: () => clearChatTraces(),
    }

    return () => {
      delete (window as any).__kawaiiChatDebug
    }
  }, [])

  useEffect(() => {
    if (!appSettings.autoErrorAssistEnabled) return undefined

    const onError = (event: ErrorEvent) => {
      const currentSettings = useSettingsStore.getState().settings
      const entry = createErrorLogEntry({
        source: 'global',
        message: event.message || 'Unknown renderer error',
        knowledgeBase: currentSettings.errorKnowledgeBase,
      })
      update({
        ...appendErrorLog(currentSettings, entry),
        errorKnowledgeBase: updateErrorKnowledgeBase(currentSettings.errorKnowledgeBase, entry),
      })
    }

    const onUnhandled = (event: PromiseRejectionEvent) => {
      const currentSettings = useSettingsStore.getState().settings
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
      const entry = createErrorLogEntry({
        source: 'global',
        message: reason || 'Unhandled promise rejection',
        knowledgeBase: currentSettings.errorKnowledgeBase,
      })
      update({
        ...appendErrorLog(currentSettings, entry),
        errorKnowledgeBase: updateErrorKnowledgeBase(currentSettings.errorKnowledgeBase, entry),
      })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandled)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandled)
    }
  }, [appSettings.autoErrorAssistEnabled, update])

  return {
    showSettings,
    setShowSettings,
    showWizard,
    setShowWizard,
    status,
    error,
    clearError,
    activeConversation,
    isLoading,
    debugMode,
    models,
    appSettings,
    update,
    refetch,
    sendMessage,
    stopStreaming,
  }
}
