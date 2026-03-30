import { useEffect, useMemo, useState } from 'react'
import Sidebar from '@/components/sidebar/Sidebar'
import ChatWindow from '@/components/chat/ChatWindow'
import ChatInput from '@/components/chat/ChatInput'
import SettingsModal from '@/components/settings/SettingsModal'
import TitleBar from '@/components/ui/TitleBar'
import SetupWizard from '@/components/wizard/SetupWizard'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useChat } from '@/hooks/useChat'
import { useModels } from '@/hooks/useModels'
import { appendErrorLog, createErrorLogEntry, updateErrorKnowledgeBase } from '@/services/errorDiagnostics'
import { ingestReleaseKnowledge } from '@/services/releaseLearning'

export default function App() {
  const [showSettings, setShowSettings] = useState(false)
  const { settings } = useSettingsStore()
  const [showWizard, setShowWizard] = useState(!settings.hasCompletedSetup)

  const { conversations, activeId } = useChatStore()
  const { update } = useSettingsStore()

  const activeConversation = useMemo(
    () => conversations.find(c => c.id === activeId),
    [conversations, activeId]
  )

  const { models, status, refetch } = useModels()
  const { sendMessage, stopStreaming, isLoading, error, clearError } = useChat(models)

  useEffect(() => {
    window.api?.getVersion?.()
      .then(version => {
        const currentSettings = useSettingsStore.getState().settings
        update({ releaseKnowledgeBase: ingestReleaseKnowledge(currentSettings, version) })
      })
      .catch(() => undefined)
  }, [update])

  useEffect(() => {
    if (!settings.autoErrorAssistEnabled) return undefined

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
  }, [settings.autoErrorAssistEnabled, update])

  return (
    <div className="h-full flex flex-col bg-kawaii-bg">
      {showWizard && <SetupWizard onComplete={() => setShowWizard(false)} />}
      <TitleBar status={status} onSettingsOpen={() => setShowSettings(true)} />

      <div className="flex-1 flex min-h-0">
        <Sidebar />

        <main className="flex-1 flex flex-col min-w-0">
          {error && (
            <div className="px-4 py-2 bg-kawaii-error/10 border-b border-kawaii-error/40 text-kawaii-error text-sm flex items-center justify-between">
              <span>{error}</span>
              <button onClick={clearError} className="text-xs underline">Cerrar</button>
            </div>
          )}

          <ChatWindow
            messages={activeConversation?.messages ?? []}
            isLoading={isLoading}
          />

          <ChatInput
            models={models}
            smartMode={settings.provider === 'smart'}
            selectedModel={
              settings.provider === 'ollama'
                ? settings.localModel || settings.defaultModel
                : settings.provider === 'openai-compatible'
                  ? settings.cloudModel || settings.defaultModel
                  : settings.provider === 'legacy-engine'
                    ? settings.legacyModel || settings.defaultModel
                  : settings.defaultModel
            }
            onModelChange={(model) => {
              if (settings.provider === 'ollama') {
                update({ localModel: model, defaultModel: model })
              } else if (settings.provider === 'openai-compatible') {
                update({ cloudModel: model, defaultModel: model })
              } else if (settings.provider === 'legacy-engine') {
                update({ legacyModel: model, defaultModel: model })
              } else {
                update({ defaultModel: model })
              }

              if (activeConversation) {
                useChatStore.setState(s => ({
                  conversations: s.conversations.map(c => c.id === activeConversation.id ? { ...c, model } : c)
                }))
              }
            }}
            onSend={sendMessage}
            onStop={stopStreaming}
            isLoading={isLoading}
          />
        </main>
      </div>

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        models={models}
        status={status}
        onRefreshModels={refetch}
      />
    </div>
  )
}
