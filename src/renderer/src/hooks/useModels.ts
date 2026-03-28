import { useState, useEffect, useCallback } from 'react'
import { createChatClient, OpenAICompatibleClient } from '@/services/aiClient'
import { getCatalogModelsForBaseUrl } from '@/services/cloudCatalog'
import { ensureLegacyRuntimeReady } from '@/services/legacyRuntime'
import { getProviderApiKey, getAdditionalProviderKey } from '@/utils/secureSettings'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIModel } from '@/types'

export type ConnectionStatus = 'checking' | 'connected' | 'disconnected'

export function useModels() {
  const [models,  setModels ] = useState<AIModel[]>([])
  const [status,  setStatus ] = useState<ConnectionStatus>('checking')
  const [loading, setLoading] = useState(false)

  const { settings, update } = useSettingsStore()

  const mergeCatalog = (baseUrl: string, keyId: string, modelsIn: AIModel[], idPrefix: string): AIModel[] => {
    const known = new Set(modelsIn.map(m => m.name.toLowerCase()))
    const curated = getCatalogModelsForBaseUrl(baseUrl)
      .filter(name => !known.has(name.toLowerCase()))
      .map((name, index) => ({
        id: `${idPrefix}:catalog:${index}:${name}`,
        name,
        provider: 'openai-compatible' as const,
        providerBaseUrl: baseUrl,
        providerKeyId: keyId,
      }))
    return [...modelsIn, ...curated]
  }

  const fetchModels = useCallback(async (): Promise<void> => {
    setLoading(true)
    setStatus('checking')

    const apiKey = await getProviderApiKey()

    try {
      if (settings.provider === 'smart') {
        const localSettings = {
          provider: 'ollama' as const,
          providerBaseUrl: settings.localBaseUrl,
          localBaseUrl: settings.localBaseUrl,
          cloudBaseUrl: settings.cloudBaseUrl,
          legacyEngineBaseUrl: settings.legacyEngineBaseUrl,
        }
        const cloudSettings = {
          provider: 'openai-compatible' as const,
          providerBaseUrl: settings.cloudBaseUrl,
          localBaseUrl: settings.localBaseUrl,
          cloudBaseUrl: settings.cloudBaseUrl,
          legacyEngineBaseUrl: settings.legacyEngineBaseUrl,
        }

        const localClient = createChatClient(localSettings, apiKey)
        const cloudClient = createChatClient(cloudSettings, apiKey)

        const legacyReady = settings.enableLegacyEngine
          ? await ensureLegacyRuntimeReady(settings, apiKey)
          : { ready: false, status: null }

        const legacyClient = legacyReady.ready
          ? createChatClient({
              provider: 'legacy-engine' as const,
              providerBaseUrl: settings.legacyEngineBaseUrl,
              localBaseUrl: settings.localBaseUrl,
              cloudBaseUrl: settings.cloudBaseUrl,
              legacyEngineBaseUrl: settings.legacyEngineBaseUrl,
            }, apiKey)
          : null

        const [localOk, cloudOk, legacyOk] = await Promise.all([
          localClient.checkConnection(),
          cloudClient.checkConnection(),
          legacyClient?.checkConnection() ?? Promise.resolve(false),
        ])

        const [localModels, cloudModelsRaw, legacyModelsRaw] = await Promise.all([
          localOk ? localClient.listModels() : Promise.resolve([]),
          cloudOk ? cloudClient.listModels() : Promise.resolve([]),
          legacyOk && legacyClient ? legacyClient.listModels() : Promise.resolve([]),
        ])
        const cloudModels = mergeCatalog(settings.cloudBaseUrl, 'providerApiKey', cloudModelsRaw, 'cloud')

        // ── Additional providers ──────────────────────────────────────────────
        const enabledAdditional = settings.additionalProviders.filter(
          ap => ap.enabled && ap.baseUrl,
        )
        const additionalResults = await Promise.allSettled(
          enabledAdditional.map(async ap => {
            const apKey = await getAdditionalProviderKey(ap.id)
            const apClient = new OpenAICompatibleClient(ap.baseUrl, apKey)
            const ok = await apClient.checkConnection()
            if (!ok) return [] as AIModel[]
            const list = await apClient.listModels()
            const enriched = mergeCatalog(ap.baseUrl, `ap_${ap.id}_key`, list, ap.id)
            return enriched.map(m => ({
              ...m,
              id: `${ap.id}:${m.id}`,
              name: `[${ap.name || ap.id}] ${m.name}`,
              provider: 'openai-compatible' as const,
              providerBaseUrl: ap.baseUrl,
              providerKeyId: `ap_${ap.id}_key`,
            }))
          }),
        )
        const additionalModels: AIModel[] = additionalResults.flatMap(r =>
          r.status === 'fulfilled' ? r.value : [],
        )
        const additionalOk = additionalModels.length > 0

        const merged: AIModel[] = [
          ...localModels.map(m => ({
            ...m,
            id: `local:${m.id}`,
            name: `[Local] ${m.name}`,
            providerBaseUrl: settings.localBaseUrl,
          })),
          ...cloudModels.map(m => ({
            ...m,
            id: `cloud:${m.id}`,
            name: `[Cloud] ${m.name}`,
            providerBaseUrl: settings.cloudBaseUrl,
            providerKeyId: 'providerApiKey',
          })),
          ...legacyModelsRaw.map(m => ({
            ...m,
            id: `legacy:${m.id}`,
            name: `[Kawaii] ${m.name}`,
            provider: 'legacy-engine' as const,
            providerBaseUrl: settings.legacyEngineBaseUrl,
          })),
          ...additionalModels,
        ]

        setStatus(localOk || cloudOk || legacyOk || additionalOk ? 'connected' : 'disconnected')
        setModels(merged)

        const patch: Partial<typeof settings> = {}
        if (!settings.localModel && localModels.length > 0) patch.localModel = localModels[0].name
        if (!settings.cloudModel && cloudModels.length > 0) patch.cloudModel = cloudModels[0].name
        if (!settings.legacyModel && legacyModelsRaw.length > 0) patch.legacyModel = legacyModelsRaw[0].name
        if (!settings.defaultModel && merged.length > 0) patch.defaultModel = merged[0].name
        if (Object.keys(patch).length > 0) update(patch)

      } else {
        // Single-provider mode — also query any enabled additional providers
        const providerBaseUrl =
          settings.provider === 'ollama'
            ? settings.localBaseUrl
            : settings.provider === 'legacy-engine'
              ? settings.legacyEngineBaseUrl
              : settings.cloudBaseUrl
        const client = createChatClient({
          provider: settings.provider,
          providerBaseUrl,
          localBaseUrl: settings.localBaseUrl,
          cloudBaseUrl: settings.cloudBaseUrl,
          legacyEngineBaseUrl: settings.legacyEngineBaseUrl,
        }, apiKey)

        if (settings.provider === 'legacy-engine') {
          const legacyReady = await ensureLegacyRuntimeReady(settings, apiKey)
          if (!legacyReady.ready) {
            setStatus('disconnected')
            setModels([])
            return
          }
        }

        const ok = await client.checkConnection()
        if (!ok) {
          setStatus('disconnected')
          setModels([])
          return
        }

        setStatus('connected')
        const list = await client.listModels()
        const withCatalog = settings.provider === 'openai-compatible'
          ? mergeCatalog(settings.cloudBaseUrl, 'providerApiKey', list, 'cloud')
          : list

        // Tag with providerBaseUrl so useChat can route correctly
        const tagged: AIModel[] = withCatalog.map(m => ({
          ...m,
          providerBaseUrl,
          providerKeyId: settings.provider === 'openai-compatible' ? 'providerApiKey' : undefined,
        }))
        setModels(tagged)

        if (!settings.defaultModel && tagged.length > 0) {
          update({ defaultModel: tagged[0].name })
        }
      }
    } catch {
      setStatus('disconnected')
      setModels([])
    } finally {
      setLoading(false)
    }
  }, [settings, update])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  return { models, status, loading, refetch: fetchModels }
}

