import { ErrorBoundary } from '@/diagnostics/ErrorBoundary'
import Sidebar from '@/components/sidebar/Sidebar'
import ChatWindow from '@/components/chat/ChatWindow'
import ChatInput from '@/components/chat/ChatInput'
import SettingsModal from '@/components/settings/SettingsModal'
import TitleBar from '@/components/ui/TitleBar'
import SetupWizard from '@/components/wizard/SetupWizard'
import { useChatStore } from '@/store/chatStore'


// Mejor práctica: separar lógica de negocio en hooks y UI en componentes
import { useAppLogic } from './hooks/useAppLogic'

function AppContent() {
  const {
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
  } = useAppLogic();

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
            convId={activeConversation?.id}
            debugMode={debugMode}
          />
          <ChatInput
            models={models}
            smartMode={appSettings.provider === 'smart'}
            selectedModel={
              appSettings.provider === 'ollama'
                ? appSettings.localModel || appSettings.defaultModel
                : appSettings.provider === 'openai-compatible'
                  ? appSettings.cloudModel || appSettings.defaultModel
                  : appSettings.provider === 'legacy-engine'
                    ? appSettings.legacyModel || appSettings.defaultModel
                  : appSettings.defaultModel
            }
            onModelChange={(model) => {
              if (appSettings.provider === 'ollama') {
                update({ localModel: model, defaultModel: model })
              } else if (appSettings.provider === 'openai-compatible') {
                update({ cloudModel: model, defaultModel: model })
              } else if (appSettings.provider === 'legacy-engine') {
                update({ legacyModel: model, defaultModel: model })
              } else {
                update({ defaultModel: model })
              }
              if (activeConversation) {
                // Mejor práctica: mutación de estado centralizada
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

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  )
}
