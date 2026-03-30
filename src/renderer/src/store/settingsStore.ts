import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_SETTINGS, type Settings } from '@/types'

interface SettingsState {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  reset:  () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      update: (patch) => set(s => ({ settings: { ...s.settings, ...patch } })),
      reset:  () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: 'kawaii-gpt-settings',
      version: 16,
      // Merge any persisted state on top of DEFAULT_SETTINGS so new fields
      // always receive their default values when upgrading.
      migrate: (persisted: unknown) => {
        const old = (persisted as { settings?: Partial<Settings> })?.settings ?? {}
        const merged = { ...DEFAULT_SETTINGS, ...old }
        // Ensure additionalProviders always has 3 slots
        if (!merged.additionalProviders || merged.additionalProviders.length < 3) {
          merged.additionalProviders = DEFAULT_SETTINGS.additionalProviders
        }
        if (typeof merged.prioritizeUnrestricted !== 'boolean') {
          merged.prioritizeUnrestricted = DEFAULT_SETTINGS.prioritizeUnrestricted
        }
        if (typeof merged.preferFreeTier !== 'boolean') {
          merged.preferFreeTier = DEFAULT_SETTINGS.preferFreeTier
        }
        if (typeof merged.cloudDiagnostics === 'undefined') {
          merged.cloudDiagnostics = DEFAULT_SETTINGS.cloudDiagnostics
        }
        if (!Array.isArray(merged.cloudConnectivity)) {
          merged.cloudConnectivity = DEFAULT_SETTINGS.cloudConnectivity
        }
        if (typeof merged.autoErrorAssistEnabled !== 'boolean') {
          merged.autoErrorAssistEnabled = DEFAULT_SETTINGS.autoErrorAssistEnabled
        }
        if (!Array.isArray(merged.errorLogs)) {
          merged.errorLogs = DEFAULT_SETTINGS.errorLogs
        }
        if (!Array.isArray(merged.errorKnowledgeBase)) {
          merged.errorKnowledgeBase = DEFAULT_SETTINGS.errorKnowledgeBase
        }
        if (!Array.isArray(merged.releaseKnowledgeBase)) {
          merged.releaseKnowledgeBase = DEFAULT_SETTINGS.releaseKnowledgeBase
        }
        if (typeof merged.lastErrorReport === 'undefined') {
          merged.lastErrorReport = DEFAULT_SETTINGS.lastErrorReport
        }
        if (typeof merged.enableLegacyEngine !== 'boolean') {
          merged.enableLegacyEngine = DEFAULT_SETTINGS.enableLegacyEngine
        }
        if (typeof merged.legacyEngineBaseUrl !== 'string') {
          merged.legacyEngineBaseUrl = DEFAULT_SETTINGS.legacyEngineBaseUrl
        }
        if (typeof merged.legacyModel !== 'string') {
          merged.legacyModel = DEFAULT_SETTINGS.legacyModel
        }
        if (typeof merged.legacyRuntimeCommand !== 'string') {
          merged.legacyRuntimeCommand = DEFAULT_SETTINGS.legacyRuntimeCommand
        }
        if (typeof merged.legacyRuntimeArgs !== 'string') {
          merged.legacyRuntimeArgs = DEFAULT_SETTINGS.legacyRuntimeArgs
        }
        if (typeof merged.legacyRuntimeCwd !== 'string') {
          merged.legacyRuntimeCwd = DEFAULT_SETTINGS.legacyRuntimeCwd
        }
        if (typeof merged.voiceInputEnabled !== 'boolean') {
          merged.voiceInputEnabled = DEFAULT_SETTINGS.voiceInputEnabled
        }
        if (typeof merged.voiceInputMode !== 'string') {
          merged.voiceInputMode = DEFAULT_SETTINGS.voiceInputMode
        }
        if (typeof merged.voiceOutputEnabled !== 'boolean') {
          merged.voiceOutputEnabled = DEFAULT_SETTINGS.voiceOutputEnabled
        }
        if (typeof merged.voiceAutoPlayResponses !== 'boolean') {
          merged.voiceAutoPlayResponses = DEFAULT_SETTINGS.voiceAutoPlayResponses
        }
        if (typeof merged.voiceAutoSend !== 'boolean') {
          merged.voiceAutoSend = DEFAULT_SETTINGS.voiceAutoSend
        }
        if (typeof merged.voiceLanguage !== 'string') {
          merged.voiceLanguage = DEFAULT_SETTINGS.voiceLanguage
        }
        if (typeof merged.voiceOutputMode !== 'string') {
          merged.voiceOutputMode = DEFAULT_SETTINGS.voiceOutputMode
        }
        if (typeof merged.voiceCloudVoice !== 'string') {
          merged.voiceCloudVoice = DEFAULT_SETTINGS.voiceCloudVoice
        }
        if (typeof merged.voiceName !== 'string') {
          merged.voiceName = DEFAULT_SETTINGS.voiceName
        }
        if (typeof merged.voicePitch !== 'number') {
          merged.voicePitch = DEFAULT_SETTINGS.voicePitch
        }
        if (typeof merged.voiceRate !== 'number') {
          merged.voiceRate = DEFAULT_SETTINGS.voiceRate
        }
        if (typeof merged.voiceDiagnostics === 'undefined') {
          merged.voiceDiagnostics = DEFAULT_SETTINGS.voiceDiagnostics
        }
        if (!merged.characterProfile || typeof merged.characterProfile !== 'object') {
          merged.characterProfile = DEFAULT_SETTINGS.characterProfile
        } else {
          merged.characterProfile = {
            ...DEFAULT_SETTINGS.characterProfile,
            ...merged.characterProfile,
          }
        }
        if (typeof merged.imageGenAutoSelect !== 'boolean') {
          merged.imageGenAutoSelect = DEFAULT_SETTINGS.imageGenAutoSelect
        }
        return { settings: merged }
      },
    }
  )
)
