import { useEffect, useRef, useState } from 'react'
import { X, RefreshCw, Cloud, Server, Plus, Image, Bot, Volume2, Upload, Trash2, Download } from 'lucide-react'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import { OllamaClient, OpenAICompatibleClient } from '@/services/aiClient'
import { sessionBlacklistedProviders } from '@/hooks/useChat'
import { listSpeechVoices } from '@/services/voice'
import { getProviderApiKey, setProviderApiKey, getAdditionalProviderKey, setAdditionalProviderKey } from '@/utils/secureSettings'
import type { AIModel, AIProvider, AdditionalProvider, CloudConnectivityStatus } from '@/types'
import type { ConversationImportMode } from '@/services/conversationTransfer'
import { buildProviderConfigExportPayload, parseProviderConfigImportPayload } from '@/services/providerConfigTransfer'
import { formatTime } from '@/utils/formatters'
import { getCatalogModelsForBaseUrl } from '@/services/cloudCatalog'

interface CloudPreset {
  id: 'openrouter' | 'openai' | 'groq' | 'gemini' | 'together'
  label: string
  baseUrl: string
  model: string
}

const CLOUD_PRESETS: CloudPreset[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter (multimodelo, recomendado)',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-5.4-mini',
  },
  {
    id: 'openai',
    label: 'OpenAI / ChatGPT API',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-1.5-flash',
  },
  {
    id: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
  },
]

interface Props {
  open: boolean
  onClose: () => void
  models: AIModel[]
  status: 'checking' | 'connected' | 'disconnected'
  onRefreshModels: () => void
}

interface ModelProbeResult {
  id: string
  label: string
  model: string
  ok: boolean
  latencyMs: number
  detail: string
  phase: 'stream-first-token' | 'chat-fallback'
  issueType: 'timeout' | 'auth' | 'quota' | 'model' | 'network' | 'unknown' | 'none'
}

export default function SettingsModal({ open, onClose, models, status, onRefreshModels }: Props) {
  const { settings, update, reset } = useSettingsStore()
  const { activeId, conversations, clearUserMemory, removeUserMemoryFact, exportBackup, importBackup } = useChatStore()
  const [apiKey, setApiKey] = useState('')
  const [additionalKeys, setAdditionalKeys] = useState<Record<string, string>>({})
  const [checkingCloud, setCheckingCloud] = useState(false)
  const [connectivityResults, setConnectivityResults] = useState<CloudConnectivityStatus[]>([])
  const [benchmarkingModels, setBenchmarkingModels] = useState(false)
  const [modelProbeResults, setModelProbeResults] = useState<ModelProbeResult[]>([])
  const [legacyRuntimeStatus, setLegacyRuntimeStatus] = useState<{ running: boolean; pid?: number; command?: string; lastError?: string } | null>(null)
  const [legacyRuntimeBusy, setLegacyRuntimeBusy] = useState(false)
  const [availableVoices, setAvailableVoices] = useState<Array<{ name: string; lang: string; default: boolean }>>([])
  const [chatImportMode, setChatImportMode] = useState<ConversationImportMode>('merge')
  const [chatTransferNotice, setChatTransferNotice] = useState('')
  const [providerTransferNotice, setProviderTransferNotice] = useState('')
  const characterImageInputRef = useRef<HTMLInputElement | null>(null)
  const chatImportInputRef = useRef<HTMLInputElement | null>(null)
  const providerImportInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    getProviderApiKey().then(setApiKey)
    const providers = settings.additionalProviders ?? []
    Promise.all(
      providers.map(async ap => {
        const key = await getAdditionalProviderKey(ap.id)
        return [ap.id, key] as [string, string]
      }),
    ).then(entries => setAdditionalKeys(Object.fromEntries(entries)))
    setConnectivityResults(settings.cloudConnectivity ?? [])
    setAvailableVoices(listSpeechVoices())
    window.api?.legacyStatus?.().then(setLegacyRuntimeStatus).catch(() => setLegacyRuntimeStatus(null))
  }, [open])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const activeConversation = conversations.find(c => c.id === activeId)
  const activeMemory = activeConversation?.userMemory ?? []

  const providerLabel = settings.provider === 'ollama'
    ? 'Ollama Base URL'
    : settings.provider === 'openai-compatible'
      ? 'Cloud Provider Base URL'
      : settings.provider === 'legacy-engine'
        ? 'Legacy Engine Base URL'
      : 'Smart Routing (local + cloud)'

  const providerPlaceholder = settings.provider === 'ollama'
    ? 'http://localhost:11434'
    : settings.provider === 'legacy-engine'
      ? 'http://127.0.0.1:8765/v1'
    : 'https://openrouter.ai/api/v1'

  const saveAndClose = async () => {
    await setProviderApiKey(apiKey.trim())
    await Promise.all(
      (settings.additionalProviders ?? []).map(ap =>
        setAdditionalProviderKey(ap.id, additionalKeys[ap.id] ?? ''),
      ),
    )
    onClose()
  }

  const exportChatConversations = () => {
    const payload = exportBackup()
    const content = JSON.stringify(payload, null, 2)
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `kawaii-chat-backup-${stamp}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setChatTransferNotice(`Respaldo exportado (${payload.chats.conversations.length} conversación(es)).`)
  }

  const beginChatImport = (mode: ConversationImportMode) => {
    setChatImportMode(mode)
    chatImportInputRef.current?.click()
  }

  const exportProviderConfiguration = async () => {
    const mainApiKey = apiKey.trim()
    const additionalApiKeys = Object.fromEntries(
      Object.entries(additionalKeys).map(([id, value]) => [id, (value ?? '').trim()]),
    )
    const runtimeMode = await window.api?.getRuntimeMode?.().catch(() => 'unknown') ?? 'unknown'
    const payload = buildProviderConfigExportPayload(
      settings,
      {
        mainApiKey,
        additionalApiKeys,
      },
      {
        mode: runtimeMode,
        url: window.location.href,
        origin: window.location.origin,
      },
    )

    const content = JSON.stringify(payload, null, 2)
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `kawaii-provider-config-${stamp}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setProviderTransferNotice(`Configuración de proveedores exportada (${payload.runtime.mode.toUpperCase()}).`)
  }

  const beginProviderImport = () => {
    providerImportInputRef.current?.click()
  }

  const onProviderImportFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const raw = JSON.parse(text)
      const parsed = parseProviderConfigImportPayload(raw)
      if (!parsed) {
        setProviderTransferNotice('No se pudo importar: archivo inválido para configuración de proveedores.')
        return
      }

      const importedProviders = parsed.providerConfig.additionalProviders
      const existingIds = new Set((settings.additionalProviders ?? []).map(item => item.id))
      const mergedProviders = (settings.additionalProviders ?? []).map(item => {
        const imported = importedProviders.find(candidate => candidate.id === item.id)
        return imported ? { ...item, ...imported } : item
      })

      const appendable = importedProviders.filter(item => !existingIds.has(item.id))
      const normalizedProviders = [...mergedProviders, ...appendable].slice(0, 3)

      const fallbackProviderBaseUrl = parsed.providerConfig.provider === 'ollama'
        ? parsed.providerConfig.localBaseUrl
        : parsed.providerConfig.provider === 'legacy-engine'
          ? parsed.providerConfig.legacyEngineBaseUrl
          : parsed.providerConfig.cloudBaseUrl

      update({
        provider: parsed.providerConfig.provider,
        providerBaseUrl: parsed.providerConfig.providerBaseUrl || fallbackProviderBaseUrl,
        localBaseUrl: parsed.providerConfig.localBaseUrl,
        cloudBaseUrl: parsed.providerConfig.cloudBaseUrl,
        legacyEngineBaseUrl: parsed.providerConfig.legacyEngineBaseUrl,
        defaultModel: parsed.providerConfig.defaultModel,
        localModel: parsed.providerConfig.localModel,
        cloudModel: parsed.providerConfig.cloudModel,
        legacyModel: parsed.providerConfig.legacyModel,
        additionalProviders: normalizedProviders,
        autoFailover: parsed.providerConfig.autoFailover,
        preferFreeTier: parsed.providerConfig.preferFreeTier,
        prioritizeUnrestricted: parsed.providerConfig.prioritizeUnrestricted,
        smartLongPromptThreshold: parsed.providerConfig.smartLongPromptThreshold,
        cloudMaxTokens: parsed.providerConfig.cloudMaxTokens,
        localMaxTokens: parsed.providerConfig.localMaxTokens,
        webSearchEnabled: parsed.providerConfig.webSearchEnabled,
        webSearchMaxResults: parsed.providerConfig.webSearchMaxResults,
        enableLegacyEngine: parsed.providerConfig.enableLegacyEngine,
        legacyRuntimeCommand: parsed.providerConfig.legacyRuntimeCommand,
        legacyRuntimeArgs: parsed.providerConfig.legacyRuntimeArgs,
        legacyRuntimeCwd: parsed.providerConfig.legacyRuntimeCwd,
      })

      await setProviderApiKey(parsed.secrets.mainApiKey)
      const nextAdditionalKeys: Record<string, string> = { ...additionalKeys }
      for (const provider of normalizedProviders) {
        const importedKey = parsed.secrets.additionalApiKeys[provider.id] ?? ''
        nextAdditionalKeys[provider.id] = importedKey
        await setAdditionalProviderKey(provider.id, importedKey)
      }

      setApiKey(parsed.secrets.mainApiKey)
      setAdditionalKeys(nextAdditionalKeys)

      const sourceRuntime = parsed.runtime ? `${parsed.runtime.mode.toUpperCase()} (${parsed.runtime.origin || 'unknown-origin'})` : 'origen desconocido'
      setProviderTransferNotice(`Configuración importada correctamente. Fuente: ${sourceRuntime}.`)
    } catch {
      setProviderTransferNotice('No se pudo importar. Verifica que el archivo JSON sea válido y completo.')
    } finally {
      event.target.value = ''
    }
  }

  const onChatImportFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const raw = JSON.parse(text)
      const result = importBackup(raw, chatImportMode)

      if (result.imported <= 0) {
        setChatTransferNotice('No se encontraron conversaciones válidas en el archivo seleccionado.')
      } else {
        const modeLabel = chatImportMode === 'replace' ? 'reemplazo total' : 'mezcla con conversaciones actuales'
        setChatTransferNotice(`Importación completada (${result.imported} conversación(es), modo: ${modeLabel}).`)
      }
    } catch {
      setChatTransferNotice('No se pudo importar. Verifica que el archivo sea JSON válido de conversaciones.')
    } finally {
      event.target.value = ''
    }
  }

  const applyRecommendedProfile = () => {
    update({
      provider: 'smart',
      cloudBaseUrl: 'https://openrouter.ai/api/v1',
      providerBaseUrl: 'https://openrouter.ai/api/v1',
      cloudModel: 'openai/gpt-5.4-mini',
      defaultModel: 'openai/gpt-5.4-mini',
      prioritizeUnrestricted: true,
      preferFreeTier: true,
      autoFailover: true,
      additionalProviders: [
        { id: 'ap1', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', enabled: Boolean(additionalKeys['ap1']?.trim()) },
        { id: 'ap2', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', enabled: Boolean(additionalKeys['ap2']?.trim()) },
        { id: 'ap3', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', enabled: Boolean(additionalKeys['ap3']?.trim()) },
      ],
    })
  }

  const setProvider = (provider: AIProvider) => {
    const providerBaseUrl =
      provider === 'ollama' ? settings.localBaseUrl :
      provider === 'legacy-engine' ? settings.legacyEngineBaseUrl :
      provider === 'openai-compatible' ? settings.cloudBaseUrl :
      settings.localBaseUrl
    update({ provider, providerBaseUrl, defaultModel: '' })
  }

  const applyCloudPreset = (preset: CloudPreset) => {
    update({
      provider: settings.provider === 'ollama' ? 'openai-compatible' : settings.provider,
      cloudBaseUrl: preset.baseUrl,
      providerBaseUrl: preset.baseUrl,
      cloudModel: preset.model,
      defaultModel: preset.model,
    })
  }

  const modelForProvider = (provider: AIProvider): string => {
    if (provider === 'ollama') return settings.localModel
    if (provider === 'openai-compatible') return settings.cloudModel
    if (provider === 'legacy-engine') return settings.legacyModel
    return settings.defaultModel
  }

  const setModelForProvider = (provider: AIProvider, model: string): void => {
    if (provider === 'ollama') { update({ localModel: model, defaultModel: model }); return }
    if (provider === 'openai-compatible') { update({ cloudModel: model, defaultModel: model }); return }
    if (provider === 'legacy-engine') { update({ legacyModel: model, defaultModel: model }); return }
    update({ defaultModel: model })
  }

  const updateAdditionalProvider = (index: number, patch: Partial<AdditionalProvider>) => {
    const newProviders = [...(settings.additionalProviders ?? [])]
    newProviders[index] = { ...newProviders[index], ...patch }
    update({ additionalProviders: newProviders })
  }

  const testCloudConnectivity = async () => {
    setCheckingCloud(true)
    setConnectivityResults([])

    const targets: Array<{ id: string; label: string; baseUrl: string; key: string; expectedModel?: string }> =
      settings.provider === 'legacy-engine'
        ? [
            {
              id: 'legacy',
              label: `Legacy (${settings.legacyEngineBaseUrl})`,
              baseUrl: settings.legacyEngineBaseUrl,
              key: apiKey.trim(),
              expectedModel: settings.legacyModel || undefined,
            },
          ]
        : [
            {
              id: 'main',
              label: `Principal (${settings.cloudBaseUrl})`,
              baseUrl: settings.cloudBaseUrl,
              key: apiKey.trim(),
              expectedModel: settings.cloudModel || undefined,
            },
            ...(settings.additionalProviders ?? [])
              .filter(ap => ap.enabled && ap.baseUrl)
              .map(ap => ({
                id: ap.id,
                label: `${ap.name || ap.id} (${ap.baseUrl})`,
                baseUrl: ap.baseUrl,
                key: (additionalKeys[ap.id] ?? '').trim(),
                expectedModel: undefined,
              })),
          ]

    const results: CloudConnectivityStatus[] = []
    const checkedAt = Date.now()

    for (const t of targets) {
      const startedAt = Date.now()

      if (!t.key && t.id !== 'legacy') {
        results.push({
          id: t.id,
          label: t.label,
          ok: false,
          detail: 'Sin API key',
          latencyMs: Date.now() - startedAt,
          checkedAt,
        })
        continue
      }

      try {
        const client = new OpenAICompatibleClient(t.baseUrl, t.key)
        const ok = await client.checkConnection()
        if (!ok) {
          results.push({
            id: t.id,
            label: t.label,
            ok: false,
            detail: 'No respondió / credenciales inválidas',
            latencyMs: Date.now() - startedAt,
            checkedAt,
          })
          continue
        }

        const modelsList = await client.listModels()
        const count = modelsList.length
        const hasExpected = t.expectedModel
          ? modelsList.some(m => m.name.toLowerCase() === t.expectedModel!.toLowerCase())
          : true

        results.push({
          id: t.id,
          label: t.label,
          ok: hasExpected,
          detail: hasExpected
            ? `OK (${count} modelos)`
            : `Conecta, pero no encuentra el modelo configurado: ${t.expectedModel}`,
          latencyMs: Date.now() - startedAt,
          checkedAt,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const shortMsg = msg.replace(/\s+/g, ' ').slice(0, 140)
        results.push({
          id: t.id,
          label: t.label,
          ok: false,
          detail: shortMsg,
          latencyMs: Date.now() - startedAt,
          checkedAt,
        })
      }
    }

    setConnectivityResults(results)
    update({ cloudConnectivity: results })
    setCheckingCloud(false)
  }

  const withProbeTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
    return await new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error(`timeout ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)

      promise
        .then(value => {
          window.clearTimeout(timer)
          resolve(value)
        })
        .catch(err => {
          window.clearTimeout(timer)
          reject(err)
        })
    })
  }

  const classifyProbeIssue = (detail: string): ModelProbeResult['issueType'] => {
    const lower = detail.toLowerCase()
    if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout'
    if (lower.includes('401') || lower.includes('invalid api key') || lower.includes('unauthorized')) return 'auth'
    if (lower.includes('402') || lower.includes('credit limit') || lower.includes('quota')) return 'quota'
    if (lower.includes('model not found') || lower.includes('no endpoints found') || lower.includes('no encuentra el modelo') || lower.includes('404')) return 'model'
    if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('econnrefused')) return 'network'
    if (lower.includes('respuesta válida') || lower.includes('primer token recibido')) return 'none'
    return 'unknown'
  }

  const buildProbeReport = (rows: ModelProbeResult[]): string => {
    const now = formatTime(Date.now())
    const lines = rows.map(r => {
      const status = r.ok ? 'OK' : 'FAIL'
      return `- ${status} | ${r.label} | ${r.model} | ${r.latencyMs}ms | ${r.phase} | ${r.issueType} | ${r.detail}`
    })
    return [`Benchmark cloud/local - ${now}`, ...lines].join('\n')
  }

  const probeCloudFirstToken = async (client: OpenAICompatibleClient, model: string, prompt: string, timeoutMs: number): Promise<string> => {
    const op = (async () => {
      for await (const chunk of client.streamChat(model, [{ role: 'user', content: prompt }], undefined, 0.1, 24)) {
        const compact = chunk.replace(/\s+/g, ' ').trim()
        if (compact) return compact
      }
      throw new Error('stream finalizado sin contenido')
    })()

    return await withProbeTimeout(op, timeoutMs)
  }

  const runModelBenchmarks = async () => {
    setBenchmarkingModels(true)
    setModelProbeResults([])

    const prompt = 'Responde solo: OK'
    const cloudTimeoutMs = 15_000
    const localTimeoutMs = 45_000

    const cloudTargets: Array<{ id: string; label: string; baseUrl: string; key: string; model: string }> = [
      {
        id: 'main',
        label: 'Cloud principal',
        baseUrl: settings.cloudBaseUrl,
        key: apiKey.trim(),
        model: settings.cloudModel || getCatalogModelsForBaseUrl(settings.cloudBaseUrl)[0] || 'openai/gpt-5.4-mini',
      },
      ...(settings.additionalProviders ?? [])
        .filter(ap => ap.enabled && ap.baseUrl)
        .map(ap => ({
          id: ap.id,
          label: ap.name || ap.id,
          baseUrl: ap.baseUrl,
          key: (additionalKeys[ap.id] ?? '').trim(),
          model: getCatalogModelsForBaseUrl(ap.baseUrl)[0] || settings.cloudModel || 'gpt-5.4-mini',
        })),
    ]

    const localModel = settings.localModel
      || models.find(m => m.provider === 'ollama')?.name
      || ''

    const localTargets: Array<{ id: string; label: string; baseUrl: string; model: string }> = localModel
      ? [{ id: 'local', label: 'Local Ollama', baseUrl: settings.localBaseUrl, model: localModel }]
      : []

    const results: ModelProbeResult[] = []

    for (const target of cloudTargets) {
      const startedAt = Date.now()
      if (!target.key) {
        results.push({
          id: target.id,
          label: target.label,
          model: target.model,
          ok: false,
          latencyMs: Date.now() - startedAt,
          detail: 'Sin API key',
          phase: 'chat-fallback',
          issueType: 'auth',
        })
        continue
      }

      const client = new OpenAICompatibleClient(target.baseUrl, target.key)
      try {
        const firstToken = await probeCloudFirstToken(client, target.model, prompt, cloudTimeoutMs)
        results.push({
          id: target.id,
          label: target.label,
          model: target.model,
          ok: true,
          latencyMs: Date.now() - startedAt,
          detail: `Primer token recibido: ${firstToken.slice(0, 50)}`,
          phase: 'stream-first-token',
          issueType: 'none',
        })
      } catch (streamErr) {
        const streamMsg = streamErr instanceof Error ? streamErr.message : String(streamErr)
        try {
          const reply = await withProbeTimeout(
            client.chat(target.model, [{ role: 'user', content: prompt }], undefined, 0.1, 32),
            cloudTimeoutMs,
          )
          const normalized = reply.replace(/\s+/g, ' ').trim().toUpperCase()
          const ok = normalized.includes('OK')
          const detail = ok
            ? 'Respuesta válida (modo chat fallback)'
            : `Respuesta inesperada: ${reply.slice(0, 80)}`
          results.push({
            id: target.id,
            label: target.label,
            model: target.model,
            ok,
            latencyMs: Date.now() - startedAt,
            detail,
            phase: 'chat-fallback',
            issueType: classifyProbeIssue(detail),
          })
        } catch (chatErr) {
          const chatMsg = chatErr instanceof Error ? chatErr.message : String(chatErr)
          const detail = `stream: ${streamMsg.replace(/\s+/g, ' ').slice(0, 90)} | chat: ${chatMsg.replace(/\s+/g, ' ').slice(0, 90)}`
          results.push({
            id: target.id,
            label: target.label,
            model: target.model,
            ok: false,
            latencyMs: Date.now() - startedAt,
            detail,
            phase: 'chat-fallback',
            issueType: classifyProbeIssue(detail),
          })
        }
      }
    }

    for (const target of localTargets) {
      const startedAt = Date.now()
      try {
        const client = new OllamaClient(target.baseUrl)
        const reply = await withProbeTimeout(
          client.chat(target.model, [{ role: 'user', content: prompt }], undefined, 0.1, 40),
          localTimeoutMs,
        )
        const normalized = reply.replace(/\s+/g, ' ').trim().toUpperCase()
        const detail = normalized.includes('OK') ? 'Respuesta válida' : `Respuesta inesperada: ${reply.slice(0, 80)}`
        results.push({
          id: target.id,
          label: target.label,
          model: target.model,
          ok: normalized.includes('OK'),
          latencyMs: Date.now() - startedAt,
          detail,
          phase: 'chat-fallback',
          issueType: classifyProbeIssue(detail),
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const detail = msg.replace(/\s+/g, ' ').slice(0, 140)
        results.push({
          id: target.id,
          label: target.label,
          model: target.model,
          ok: false,
          latencyMs: Date.now() - startedAt,
          detail,
          phase: 'chat-fallback',
          issueType: classifyProbeIssue(detail),
        })
      }
    }

    const main = results.find(r => r.id === 'main')
    if (
      main &&
      !main.ok &&
      /openrouter\.ai/i.test(settings.cloudBaseUrl) &&
      /no endpoints found|no encuentra el modelo|model not found/i.test(main.detail)
    ) {
      update({
        cloudModel: 'openai/gpt-5.4-mini',
        defaultModel: 'openai/gpt-5.4-mini',
      })
      main.detail = `${main.detail} -> auto-ajuste aplicado: cloudModel=openai/gpt-5.4-mini`
      main.issueType = 'model'
    }

    // Keep session blacklist aligned with latest benchmark:
    // - Never blacklist the main provider here (it may be auto-healed by model/key updates)
    // - If a provider recovers, remove it from blacklist immediately
    for (const r of results) {
      const target = cloudTargets.find(t => t.id === r.id)
      if (!target?.baseUrl) continue
      const key = target.baseUrl.toLowerCase()

      if (r.ok) {
        sessionBlacklistedProviders.delete(key)
        continue
      }

      if (r.id === 'main') continue
      if (r.issueType === 'auth' || r.issueType === 'quota' || r.issueType === 'model') {
        sessionBlacklistedProviders.add(key)
      }
    }

    const report = buildProbeReport(results)
    update({
      cloudDiagnostics: {
        lastProvider: 'benchmark',
        lastError: report,
        lastAt: Date.now(),
        attempt: results.filter(r => !r.ok).length,
        total: results.length,
      },
    })

    setModelProbeResults(results)
    setBenchmarkingModels(false)
  }

  const refreshLegacyRuntimeStatus = async () => {
    try {
      const s = await window.api?.legacyStatus?.()
      if (s) setLegacyRuntimeStatus(s)
    } catch {
      // ignore
    }
  }

  const startLegacyRuntime = async () => {
    setLegacyRuntimeBusy(true)
    try {
      const next = await window.api?.legacyStart?.({
        command: settings.legacyRuntimeCommand,
        args: settings.legacyRuntimeArgs,
        cwd: settings.legacyRuntimeCwd,
      })
      if (next) setLegacyRuntimeStatus(next)
    } finally {
      setLegacyRuntimeBusy(false)
    }
  }

  const stopLegacyRuntime = async () => {
    setLegacyRuntimeBusy(true)
    try {
      const next = await window.api?.legacyStop?.()
      if (next) setLegacyRuntimeStatus(next)
    } finally {
      setLegacyRuntimeBusy(false)
    }
  }

  const onCharacterImageSelected: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      event.target.value = ''
      return
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('No se pudo leer la imagen del personaje.'))
      reader.onload = () => resolve(String(reader.result || ''))
      reader.readAsDataURL(file)
    }).catch(() => '')

    if (!dataUrl) {
      event.target.value = ''
      return
    }

    update({
      characterProfile: {
        ...settings.characterProfile,
        profileImageDataUrl: dataUrl,
        profileImageName: file.name,
        profileImageMimeType: file.type || 'image/png',
      },
    })

    event.target.value = ''
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm animate-fade-in">
      <div className="w-[680px] max-w-[94vw] max-h-[90vh] overflow-y-auto bg-kawaii-surface border border-kawaii-surface-3 rounded-2xl shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-kawaii-surface-3">
          <h2 className="text-lg font-extrabold gradient-text">Settings ⚙️</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-kawaii-muted hover:text-kawaii-text hover:bg-kawaii-surface-2">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">

          {/* ── Provider ───────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <label className="block text-sm font-bold text-kawaii-text">AI Provider</label>
            <div className={`grid gap-2 ${settings.enableLegacyEngine ? 'grid-cols-4' : 'grid-cols-3'}`}>
              <ProviderCard
                icon={<Server size={16} />}
                title="Ollama"
                subtitle="Local o endpoint Ollama remoto"
                active={settings.provider === 'ollama'}
                onClick={() => setProvider('ollama')}
              />
              <ProviderCard
                icon={<Cloud size={16} />}
                title="Cloud"
                subtitle="OpenRouter, OpenAI, Groq y similares"
                active={settings.provider === 'openai-compatible'}
                onClick={() => setProvider('openai-compatible')}
              />
              <ProviderCard
                icon={<RefreshCw size={16} />}
                title="Smart"
                subtitle="Balance automático local + nube + Kawaii + IA generativa"
                active={settings.provider === 'smart'}
                onClick={() => setProvider('smart')}
              />
              {settings.enableLegacyEngine && (
                <ProviderCard
                  icon={<Server size={16} />}
                  title="Legacy"
                  subtitle="Motor externo KawaiiGPT"
                  active={settings.provider === 'legacy-engine'}
                  onClick={() => setProvider('legacy-engine')}
                />
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                id="enable-legacy-engine"
                type="checkbox"
                className="accent-kawaii-pink"
                checked={settings.enableLegacyEngine}
                onChange={(e) => {
                  const checked = e.target.checked
                  const patch: Partial<typeof settings> = { enableLegacyEngine: checked }
                  if (!checked && settings.provider === 'legacy-engine') {
                    patch.provider = 'smart'
                    patch.providerBaseUrl = settings.localBaseUrl
                  }
                  update(patch)
                }}
              />
              <label htmlFor="enable-legacy-engine" className="text-xs text-kawaii-dim">
                Habilitar motor Kawaii dentro de la estrategia Smart y como modo manual
              </label>
            </div>

            {(settings.provider === 'openai-compatible' || settings.provider === 'smart') && (
              <div className="mt-2">
                <p className="text-xs text-kawaii-dim mb-2">Proveedor cloud principal (presets):</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {CLOUD_PRESETS.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyCloudPreset(p)}
                      className={`text-left px-2.5 py-2 rounded-lg border text-xs transition-all ${
                        settings.cloudBaseUrl === p.baseUrl
                          ? 'border-kawaii-pink bg-kawaii-surface-2 text-kawaii-text'
                          : 'border-kawaii-surface-3 bg-kawaii-surface text-kawaii-dim hover:text-kawaii-text hover:bg-kawaii-surface-2'
                      }`}
                    >
                      <div className="font-semibold">{p.label}</div>
                      <div className="text-[10px] opacity-80">{p.baseUrl} · {p.model}</div>
                    </button>
                  ))}
                </div>
                    {settings.enableLegacyEngine && (
                      <p className="mt-2 text-[11px] text-kawaii-dim leading-relaxed">
                        Smart usará Kawaii para prompts largos/creativos y como respaldo cuando la nube falle.
                      </p>
                    )}
              </div>
            )}

            {(settings.enableLegacyEngine || settings.provider === 'legacy-engine') && (
              <div className="mt-2 border border-kawaii-surface-3 rounded-xl p-3 bg-kawaii-surface-2 space-y-2">
                <div className="text-xs font-semibold text-kawaii-text">Runtime Legacy (fase 2)</div>

                <div>
                  <label className="block text-[11px] text-kawaii-dim mb-1">Comando</label>
                  <input
                    type="text"
                    value={settings.legacyRuntimeCommand}
                    onChange={(e) => update({ legacyRuntimeCommand: e.target.value })}
                    className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple"
                    placeholder="python"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-kawaii-dim mb-1">Args</label>
                  <input
                    type="text"
                    value={settings.legacyRuntimeArgs}
                    onChange={(e) => update({ legacyRuntimeArgs: e.target.value })}
                    className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple"
                    placeholder="kawai.py --api --port 8765"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-kawaii-dim mb-1">Directorio de trabajo (opcional)</label>
                  <input
                    type="text"
                    value={settings.legacyRuntimeCwd}
                    onChange={(e) => update({ legacyRuntimeCwd: e.target.value })}
                    className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple"
                    placeholder="C:/ruta/KawaiiGPT"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={legacyRuntimeBusy}
                    onClick={startLegacyRuntime}
                    className="px-2.5 py-1.5 rounded-lg bg-kawaii-surface border border-kawaii-surface-3 text-xs hover:bg-kawaii-surface-3 disabled:opacity-60"
                  >
                    Iniciar runtime
                  </button>
                  <button
                    type="button"
                    disabled={legacyRuntimeBusy}
                    onClick={stopLegacyRuntime}
                    className="px-2.5 py-1.5 rounded-lg bg-kawaii-surface border border-kawaii-surface-3 text-xs hover:bg-kawaii-surface-3 disabled:opacity-60"
                  >
                    Detener runtime
                  </button>
                  <button
                    type="button"
                    disabled={legacyRuntimeBusy}
                    onClick={refreshLegacyRuntimeStatus}
                    className="px-2.5 py-1.5 rounded-lg bg-kawaii-surface border border-kawaii-surface-3 text-xs hover:bg-kawaii-surface-3 disabled:opacity-60"
                  >
                    Refrescar
                  </button>
                </div>

                {legacyRuntimeStatus && (
                  <div className="text-[11px] text-kawaii-dim leading-relaxed border-t border-kawaii-surface-3 pt-1">
                    <div>Estado: <span className={legacyRuntimeStatus.running ? 'text-kawaii-success' : 'text-kawaii-dim'}>{legacyRuntimeStatus.running ? 'en ejecución' : 'detenido'}</span></div>
                    {typeof legacyRuntimeStatus.pid === 'number' && <div>PID: <span className="text-kawaii-text">{legacyRuntimeStatus.pid}</span></div>}
                    {legacyRuntimeStatus.command && <div>Comando: <span className="text-kawaii-text">{legacyRuntimeStatus.command}</span></div>}
                    {legacyRuntimeStatus.lastError && <div>Último mensaje: <span className="text-kawaii-text">{legacyRuntimeStatus.lastError}</span></div>}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Endpoints ──────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <label className="block text-sm font-bold text-kawaii-text">{providerLabel}</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.provider === 'ollama' ? settings.localBaseUrl : settings.provider === 'legacy-engine' ? settings.legacyEngineBaseUrl : settings.cloudBaseUrl}
                onChange={(e) => {
                  const value = e.target.value.trim()
                  if (settings.provider === 'ollama') update({ localBaseUrl: value, providerBaseUrl: value })
                  else if (settings.provider === 'legacy-engine') update({ legacyEngineBaseUrl: value, providerBaseUrl: value })
                  else update({ cloudBaseUrl: value, providerBaseUrl: value })
                }}
                className="flex-1 bg-kawaii-surface-2 border border-kawaii-surface-3 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-kawaii-purple"
                placeholder={providerPlaceholder}
              />
              <button
                onClick={onRefreshModels}
                className="px-3 rounded-lg bg-kawaii-surface-2 border border-kawaii-surface-3 hover:bg-kawaii-surface-3"
                title="Refresh models"
              >
                <RefreshCw size={16} />
              </button>
            </div>
            <p className={`text-xs ${status === 'connected' ? 'text-kawaii-success' : status === 'disconnected' ? 'text-kawaii-error' : 'text-kawaii-muted'}`}>
              Status: {status}
            </p>
            {settings.provider === 'smart' && (
              <>
                <input
                  type="text"
                  value={settings.localBaseUrl}
                  onChange={(e) => update({ localBaseUrl: e.target.value.trim() })}
                  className="w-full bg-kawaii-surface-2 border border-kawaii-surface-3 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-kawaii-purple"
                  placeholder="Local URL: http://localhost:11434"
                />
                <input
                  type="text"
                  value={settings.cloudBaseUrl}
                  onChange={(e) => update({ cloudBaseUrl: e.target.value.trim() })}
                  className="w-full bg-kawaii-surface-2 border border-kawaii-surface-3 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-kawaii-purple"
                  placeholder="Cloud URL: https://openrouter.ai/api/v1"
                />
              </>
            )}
          </section>

          {/* ── Cloud API key (main provider) ──────────────────────────────── */}
          {(settings.provider === 'openai-compatible' || settings.provider === 'smart' || settings.provider === 'legacy-engine') && (
            <section className="space-y-2">
              <label className="block text-sm font-bold text-kawaii-text">
                {settings.provider === 'smart'
                  ? 'Cloud Provider API Key'
                  : settings.provider === 'legacy-engine'
                    ? 'Legacy Engine API Key (opcional)'
                    : 'API Key'}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full bg-kawaii-surface-2 border border-kawaii-surface-3 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-kawaii-purple"
                placeholder="sk-..."
              />
              <p className="text-[11px] text-kawaii-dim">
                Guardada localmente en la app fuera del renderer.
              </p>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={testCloudConnectivity}
                  disabled={checkingCloud}
                  className="w-full py-2 rounded-lg bg-kawaii-surface-2 border border-kawaii-surface-3 text-kawaii-text text-xs hover:bg-kawaii-surface-3 disabled:opacity-60"
                >
                  {checkingCloud
                    ? 'Probando conectividad...'
                    : settings.provider === 'legacy-engine'
                      ? 'Probar conectividad legacy'
                      : 'Probar conectividad cloud (main + adicionales)'}
                </button>

                <button
                  type="button"
                  onClick={runModelBenchmarks}
                  disabled={benchmarkingModels}
                  className="mt-2 w-full py-2 rounded-lg bg-kawaii-surface-2 border border-kawaii-surface-3 text-kawaii-text text-xs hover:bg-kawaii-surface-3 disabled:opacity-60"
                >
                  {benchmarkingModels
                    ? 'Midiendo latencia por modelo...'
                    : 'Probar mensaje rápido por modelo (cloud + local)'}
                </button>

                {connectivityResults.length > 0 && (
                  <div className="mt-2 border border-kawaii-surface-3 rounded-lg bg-kawaii-surface-2 p-2.5 text-xs space-y-1.5">
                    {connectivityResults.map(r => (
                      <div key={r.id} className="flex items-start justify-between gap-2">
                        <div>
                          <div className={`font-semibold ${r.ok ? 'text-kawaii-success' : 'text-kawaii-error'}`}>
                            {r.ok ? '●' : '○'} {r.label}
                          </div>
                          <div className="text-kawaii-dim">{r.detail}</div>
                        </div>
                        <div className="text-kawaii-dim whitespace-nowrap">{r.latencyMs} ms</div>
                      </div>
                    ))}
                    <div className="pt-1 text-kawaii-dim border-t border-kawaii-surface-3">
                      Ultima prueba: {formatTime(connectivityResults[0].checkedAt)}
                    </div>
                  </div>
                )}

                {modelProbeResults.length > 0 && (
                  <div className="mt-2 border border-kawaii-surface-3 rounded-lg bg-kawaii-surface-2 p-2.5 text-xs space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-kawaii-text">Benchmark de mensaje corto por modelo</div>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(buildProbeReport(modelProbeResults))}
                        className="rounded-lg border border-kawaii-surface-3 px-2 py-1 text-kawaii-dim hover:text-kawaii-text hover:bg-kawaii-surface-3"
                      >
                        Copiar reporte
                      </button>
                    </div>
                    {modelProbeResults.map(r => (
                      <div key={`${r.id}:${r.model}`} className="flex items-start justify-between gap-2">
                        <div>
                          <div className={`font-semibold ${r.ok ? 'text-kawaii-success' : 'text-kawaii-error'}`}>
                            {r.ok ? '●' : '○'} {r.label} · {r.model}
                          </div>
                          <div className="text-kawaii-dim">{r.detail}</div>
                          <div className="text-[11px] text-kawaii-dim">fase: {r.phase} · tipo: {r.issueType}</div>
                        </div>
                        <div className="text-kawaii-dim whitespace-nowrap">{r.latencyMs} ms</div>
                      </div>
                    ))}
                    <div className="pt-1 text-kawaii-dim border-t border-kawaii-surface-3">
                      Sugerencia: prioriza rutas &lt; 5000ms y descarta auth/quota/model. Si stream-first-token pasa, el proveedor está vivo aunque chat-fallback falle.
                    </div>
                  </div>
                )}
              </div>

              {settings.cloudDiagnostics && (
                <div className="mt-2 border border-kawaii-surface-3 rounded-lg bg-kawaii-surface-2 p-2.5 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-kawaii-text">Diagnóstico cloud reciente</span>
                    <button
                      type="button"
                      onClick={() => update({ cloudDiagnostics: null })}
                      className="text-kawaii-dim hover:text-kawaii-text"
                    >
                      Limpiar
                    </button>
                  </div>
                  <div className="text-kawaii-dim leading-relaxed">
                    <div>Proveedor: <span className="text-kawaii-text">{settings.cloudDiagnostics.lastProvider}</span></div>
                    <div>Error: <span className="text-kawaii-text">{settings.cloudDiagnostics.lastError}</span></div>
                    <div>Intento: <span className="text-kawaii-text">{settings.cloudDiagnostics.attempt}/{settings.cloudDiagnostics.total}</span></div>
                    {typeof settings.cloudDiagnostics.code === 'number' && (
                      <div>Código HTTP: <span className="text-kawaii-text">{settings.cloudDiagnostics.code}</span></div>
                    )}
                    <div>Hora: <span className="text-kawaii-text">{formatTime(settings.cloudDiagnostics.lastAt)}</span></div>
                  </div>
                </div>
              )}

              <div className="mt-2 border border-kawaii-surface-3 rounded-lg bg-kawaii-surface-2 p-2.5 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-kawaii-text">Logger automatico y diagnostico de errores</span>
                  <label className="flex items-center gap-2 text-kawaii-dim">
                    <input
                      type="checkbox"
                      checked={settings.autoErrorAssistEnabled}
                      onChange={(e) => update({ autoErrorAssistEnabled: e.target.checked })}
                      className="accent-kawaii-pink"
                    />
                    Activo
                  </label>
                </div>

                {settings.errorLogs.length === 0 ? (
                  <p className="text-kawaii-dim">Sin errores registrados localmente.</p>
                ) : (
                  <div className="space-y-2">
                    <div className="max-h-40 overflow-auto space-y-1">
                      {settings.errorLogs.slice(0, 6).map(entry => (
                        <div key={entry.id} className="rounded-md border border-kawaii-surface-3 px-2 py-1.5 text-kawaii-dim">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-kawaii-text">{entry.analysis.category} · {entry.status}</span>
                            <span>{formatTime(entry.at)}</span>
                          </div>
                          <div>{entry.message}</div>
                          <div className="text-[11px]">Provider: {entry.provider || 'n/a'} · Ruta: {entry.route || 'n/a'}</div>
                          {entry.analysis.recognitionNotes.length > 0 && (
                            <div className="text-[11px]">Señales: {entry.analysis.recognitionNotes.slice(0, 5).join(' | ')}</div>
                          )}
                          <div className="text-[11px]">{entry.analysis.probableCause}</div>
                          <div className="text-[11px]">Sugerencia: {entry.analysis.suggestedFix}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => update({ errorLogs: [], lastErrorReport: null })}
                        className="rounded-lg border border-kawaii-surface-3 px-2 py-1 text-kawaii-dim hover:text-kawaii-text hover:bg-kawaii-surface-3"
                      >
                        Limpiar logs
                      </button>
                    </div>
                  </div>
                )}

                {settings.lastErrorReport && (
                  <div className="space-y-1">
                    <div className="font-semibold text-kawaii-text">Reporte automatico listo</div>
                    <textarea
                      readOnly
                      value={settings.lastErrorReport}
                      rows={7}
                      className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-2 text-[11px] text-kawaii-dim"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(settings.lastErrorReport || '')}
                        className="rounded-lg border border-kawaii-surface-3 px-2 py-1 text-kawaii-dim hover:text-kawaii-text hover:bg-kawaii-surface-3"
                      >
                        Copiar reporte
                      </button>
                      <button
                        type="button"
                        onClick={() => update({ lastErrorReport: null })}
                        className="rounded-lg border border-kawaii-surface-3 px-2 py-1 text-kawaii-dim hover:text-kawaii-text hover:bg-kawaii-surface-3"
                      >
                        Ocultar
                      </button>
                    </div>
                  </div>
                )}

              </div>
            </section>
          )}

          {/* ── Additional cloud providers ──────────────────────────────────── */}
          <section className="space-y-2">
            <label className="block text-sm font-bold text-kawaii-text flex items-center gap-2">
              <Plus size={14} className="text-kawaii-purple" />
              Proveedores adicionales
            </label>
            <p className="text-[11px] text-kawaii-dim leading-relaxed">
              Conecta providers extra (Groq, Gemini, Together, OpenAI, etc.) para mejorar la rotación cloud.
              Sus modelos aparecen marcados con [NombreProveedor] en el selector.
            </p>
            {(settings.additionalProviders ?? []).map((ap, i) => (
              <div key={ap.id} className="border border-kawaii-surface-3 rounded-xl p-3 space-y-2 bg-kawaii-surface-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`ap-${ap.id}-enabled`}
                    checked={ap.enabled}
                    onChange={e => updateAdditionalProvider(i, { enabled: e.target.checked })}
                    className="accent-kawaii-pink"
                  />
                  <label htmlFor={`ap-${ap.id}-enabled`} className="text-xs font-semibold text-kawaii-text">
                    Proveedor {i + 1}
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={ap.name}
                    onChange={e => updateAdditionalProvider(i, { name: e.target.value })}
                    className="bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple"
                    placeholder="Nombre (ej. Groq)"
                  />
                  <input
                    type="text"
                    value={ap.baseUrl}
                    onChange={e => updateAdditionalProvider(i, { baseUrl: e.target.value.trim() })}
                    className="bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple"
                    placeholder="URL base (ej. https://api.groq.com/openai/v1)"
                  />
                </div>
                <input
                  type="password"
                  value={additionalKeys[ap.id] ?? ''}
                  onChange={e => setAdditionalKeys(prev => ({ ...prev, [ap.id]: e.target.value }))}
                  className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple"
                  placeholder="API Key del proveedor"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={applyRecommendedProfile}
              className="w-full py-2 rounded-lg bg-kawaii-surface-2 border border-kawaii-surface-3 text-kawaii-text text-xs hover:bg-kawaii-surface-3"
            >
              Aplicar perfil recomendado: gratis + smart + rotacion
            </button>
          </section>

          {/* ── Models ─────────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <label className="block text-sm font-bold text-kawaii-text">
              {settings.provider === 'smart' ? 'Smart Model Pool' : 'Default Model'}
            </label>
            <select
              value={modelForProvider(settings.provider)}
              onChange={(e) => setModelForProvider(settings.provider, e.target.value)}
              className="w-full bg-kawaii-surface-2 border border-kawaii-surface-3 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-kawaii-purple"
            >
              {models.length === 0 ? (
                <option value="">No models available — refresh</option>
              ) : (
                models.map(model => (
                  <option key={model.id} value={model.name}>{model.name}</option>
                ))
              )}
            </select>

            {settings.provider === 'smart' && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <input
                  type="text"
                  value={settings.localModel}
                  onChange={(e) => update({ localModel: e.target.value.trim() })}
                  className="bg-kawaii-surface-2 border border-kawaii-surface-3 rounded-lg px-2 py-2"
                  placeholder="Model local (ej. qwen2.5:0.5b)"
                />
                <input
                  type="text"
                  value={settings.cloudModel}
                  onChange={(e) => update({ cloudModel: e.target.value.trim() })}
                  className="bg-kawaii-surface-2 border border-kawaii-surface-3 rounded-lg px-2 py-2"
                  placeholder="Model cloud (ej. openai/gpt-4.1-mini)"
                />
              </div>
            )}
            <p className="text-[11px] text-kawaii-dim">
              El catalogo cloud incluye familias GPT/ChatGPT, Gemini y Llama para seleccion automatica inteligente.
            </p>
          </section>

          {/* ── Generative AI ───────────────────────────────────────────────── */}
          <section className="space-y-2 border border-kawaii-surface-3 rounded-xl p-3 bg-kawaii-surface-2">
            <div className="flex items-center gap-2">
              <Image size={14} className="text-kawaii-pink" />
              <label className="text-sm font-bold text-kawaii-text">IA Generativa (imágenes)</label>
            </div>
            <label className="flex items-center gap-2 text-sm text-kawaii-text">
              <input
                type="checkbox"
                checked={settings.imageGenEnabled}
                onChange={(e) => update({ imageGenEnabled: e.target.checked })}
                className="accent-kawaii-pink"
              />
              Activar generación de imágenes
            </label>
            {settings.imageGenEnabled && (
              <>
                <label className="flex items-center gap-2 text-sm text-kawaii-text">
                  <input
                    type="checkbox"
                    checked={settings.imageGenAutoSelect}
                    onChange={(e) => update({ imageGenAutoSelect: e.target.checked })}
                    className="accent-kawaii-pink"
                  />
                  Auto-seleccionar modelo de imagen según proveedor
                </label>
                <div>
                  <label className="block text-xs text-kawaii-muted mb-1">Modelo de imagen</label>
                  <input
                    type="text"
                    value={settings.imageGenModel}
                    onChange={(e) => update({ imageGenModel: e.target.value.trim() })}
                    disabled={settings.imageGenAutoSelect}
                    className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple"
                    placeholder="dall-e-3  |  openai/dall-e-3  |  stability/stable-diffusion-3"
                  />
                </div>
                <p className="text-[11px] text-kawaii-dim leading-relaxed">
                  {settings.imageGenAutoSelect
                    ? 'Smart elegirá automáticamente el mejor modelo de imagen compatible por proveedor y rotará si encuentra incompatibilidades.'
                    : 'Usa el endpoint del proveedor cloud. Escribe /img tu prompt o frases como "genera una imagen de…" para activarlo.'}
                </p>
              </>
            )}
          </section>

          {/* ── Voice Chat ───────────────────────────────────────────────────── */}
          <section className="space-y-2 border border-kawaii-surface-3 rounded-xl p-3 bg-kawaii-surface-2">
            <div className="flex items-center gap-2">
              <span className="text-kawaii-teal">🎤</span>
              <label className="text-sm font-bold text-kawaii-text">Chat de voz</label>
            </div>

            <label className="flex items-center gap-2 text-sm text-kawaii-text">
              <input
                type="checkbox"
                checked={settings.voiceInputEnabled}
                onChange={(e) => update({ voiceInputEnabled: e.target.checked })}
                className="accent-kawaii-pink"
              />
              Activar entrada por voz (micrófono)
            </label>

            <div>
              <label className="block text-xs text-kawaii-muted mb-1">Modo de dictado</label>
              <select
                value={settings.voiceInputMode}
                onChange={(e) => update({ voiceInputMode: e.target.value as 'auto' | 'browser' | 'cloud' })}
                disabled={!settings.voiceInputEnabled}
                className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple disabled:opacity-50"
              >
                <option value="auto">Auto inteligente</option>
                <option value="browser">Solo navegador</option>
                <option value="cloud">Solo cloud</option>
              </select>
              <p className="mt-1 text-[11px] text-kawaii-dim leading-relaxed">
                Auto usa Web Speech cuando responde bien y cae a transcripción cloud OpenAI-compatible si el runtime no lo soporta.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-kawaii-text">
              <input
                type="checkbox"
                checked={settings.voiceAutoSend}
                onChange={(e) => update({ voiceAutoSend: e.target.checked })}
                className="accent-kawaii-pink"
              />
              Auto-enviar al terminar dictado
            </label>

            <label className="flex items-center gap-2 text-sm text-kawaii-text">
              <input
                type="checkbox"
                checked={settings.voiceOutputEnabled}
                onChange={(e) => update({
                  voiceOutputEnabled: e.target.checked,
                  voiceAutoPlayResponses: e.target.checked ? settings.voiceAutoPlayResponses : false,
                })}
                className="accent-kawaii-pink"
              />
              Activar texto a voz (TTS manual)
            </label>

            <label className="flex items-center gap-2 text-sm text-kawaii-text">
              <input
                type="checkbox"
                checked={settings.voiceAutoPlayResponses}
                disabled={!settings.voiceOutputEnabled}
                onChange={(e) => update({ voiceAutoPlayResponses: e.target.checked })}
                className="accent-kawaii-pink"
              />
              Leer respuestas automáticamente
            </label>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-kawaii-muted mb-1">Idioma de voz</label>
                <select
                  value={settings.voiceLanguage}
                  onChange={(e) => update({ voiceLanguage: e.target.value })}
                  className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple"
                >
                  <option value="es-ES">Español (España)</option>
                  <option value="es-MX">Español (México)</option>
                  <option value="en-US">English (US)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-kawaii-muted mb-1">Velocidad TTS</label>
                <input
                  type="number"
                  min={0.5}
                  max={1.5}
                  step={0.1}
                  value={settings.voiceRate}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (!Number.isFinite(v)) return
                    update({ voiceRate: Math.max(0.5, Math.min(1.5, v)) })
                  }}
                  className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-kawaii-muted mb-1">Modo de salida de voz</label>
              <select
                value={settings.voiceOutputMode}
                onChange={(e) => update({ voiceOutputMode: e.target.value as 'auto' | 'system' | 'openai' })}
                disabled={!settings.voiceOutputEnabled}
                className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple disabled:opacity-50"
              >
                <option value="auto">Auto inteligente</option>
                <option value="openai">Preferir OpenAI TTS</option>
                <option value="system">Solo voz del sistema</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-kawaii-muted mb-1">Voz TTS</label>
                <select
                  value={settings.voiceName}
                  onChange={(e) => update({ voiceName: e.target.value })}
                  disabled={!settings.voiceOutputEnabled}
                  className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple disabled:opacity-50"
                >
                  <option value="">Auto natural</option>
                  {availableVoices.map(voice => (
                    <option key={`${voice.name}:${voice.lang}`} value={voice.name}>
                      {voice.name} ({voice.lang}){voice.default ? ' - default' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-kawaii-muted mb-1">Tono TTS</label>
                <input
                  type="number"
                  min={0.8}
                  max={1.3}
                  step={0.1}
                  value={settings.voicePitch}
                  disabled={!settings.voiceOutputEnabled}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (!Number.isFinite(v)) return
                    update({ voicePitch: Math.max(0.8, Math.min(1.3, v)) })
                  }}
                  className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple disabled:opacity-50"
                />
              </div>
            </div>

            {(settings.voiceOutputMode === 'auto' || settings.voiceOutputMode === 'openai') && (
              <div>
                <label className="block text-xs text-kawaii-muted mb-1">Voz cloud preferida</label>
                <select
                  value={settings.voiceCloudVoice}
                  onChange={(e) => update({ voiceCloudVoice: e.target.value })}
                  className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple"
                >
                  {['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'].map(voice => (
                    <option key={voice} value={voice}>{voice}</option>
                  ))}
                </select>
              </div>
            )}

            <p className="text-[11px] text-kawaii-dim leading-relaxed">
              Auto inteligente: intenta OpenAI TTS si hay una API oficial disponible; si no, usa la mejor voz local instalada. La voz que escuchas siempre es sintética.
            </p>

            {settings.voiceDiagnostics && (
              <div className="rounded-lg border border-kawaii-surface-3 bg-kawaii-surface p-2.5 text-xs text-kawaii-dim">
                <div className="mb-1 flex items-center gap-2 font-semibold text-kawaii-text">
                  <Volume2 size={13} className="text-kawaii-teal" />
                  Ultima voz usada de verdad
                </div>
                <div>Motor: <span className="text-kawaii-text">{settings.voiceDiagnostics.lastEngine}</span></div>
                <div>Voz pedida: <span className="text-kawaii-text">{settings.voiceDiagnostics.lastRequestedVoice || 'auto'}</span></div>
                <div>Voz resuelta: <span className="text-kawaii-text">{settings.voiceDiagnostics.lastResolvedVoice}</span></div>
                <div>Idioma: <span className="text-kawaii-text">{settings.voiceDiagnostics.lastLanguage}</span></div>
                <div>Hora: <span className="text-kawaii-text">{formatTime(settings.voiceDiagnostics.lastAt)}</span></div>
              </div>
            )}
          </section>

          {/* ── Character Builder ─────────────────────────────────────────── */}
          <section className="space-y-2 border border-kawaii-surface-3 rounded-xl p-3 bg-kawaii-surface-2">
            <div className="flex items-center gap-2">
              <Bot size={14} className="text-kawaii-purple" />
              <label className="text-sm font-bold text-kawaii-text">Personaje / rol persistente</label>
            </div>

            <label className="flex items-center gap-2 text-sm text-kawaii-text">
              <input
                type="checkbox"
                checked={settings.characterProfile.enabled}
                onChange={(e) => update({
                  characterProfile: {
                    ...settings.characterProfile,
                    enabled: e.target.checked,
                  },
                })}
                className="accent-kawaii-pink"
              />
              Activar personaje específico
            </label>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-kawaii-muted mb-1">Nombre</label>
                <input
                  type="text"
                  value={settings.characterProfile.name}
                  onChange={(e) => update({
                    characterProfile: {
                      ...settings.characterProfile,
                      name: e.target.value,
                    },
                  })}
                  className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple"
                  placeholder="Ej. Aleia"
                />
              </div>
              <div>
                <label className="block text-xs text-kawaii-muted mb-1">Vinculo con el usuario</label>
                <input
                  type="text"
                  value={settings.characterProfile.relationship}
                  onChange={(e) => update({
                    characterProfile: {
                      ...settings.characterProfile,
                      relationship: e.target.value,
                    },
                  })}
                  className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-kawaii-purple"
                  placeholder="Ej. compañera cercana, interest romántico, mentora"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-kawaii-muted mb-1">Identidad base</label>
              <textarea
                value={settings.characterProfile.identity}
                onChange={(e) => update({
                  characterProfile: {
                    ...settings.characterProfile,
                    identity: e.target.value,
                  },
                })}
                rows={2}
                className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs leading-relaxed focus:outline-none focus:border-kawaii-purple"
                placeholder="Quién es, qué edad aparenta, qué presencia transmite, qué desea proyectar."
              />
            </div>

            <div>
              <label className="block text-xs text-kawaii-muted mb-1">Personalidad y actitudes</label>
              <textarea
                value={settings.characterProfile.personality}
                onChange={(e) => update({
                  characterProfile: {
                    ...settings.characterProfile,
                    personality: e.target.value,
                  },
                })}
                rows={3}
                className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs leading-relaxed focus:outline-none focus:border-kawaii-purple"
                placeholder="Describe rasgos, intensidad emocional, ternura, sarcasmo, dominancia, dulzura, etc."
              />
            </div>

            <div>
              <label className="block text-xs text-kawaii-muted mb-1">Forma de hablar</label>
              <textarea
                value={settings.characterProfile.speakingStyle}
                onChange={(e) => update({
                  characterProfile: {
                    ...settings.characterProfile,
                    speakingStyle: e.target.value,
                  },
                })}
                rows={2}
                className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs leading-relaxed focus:outline-none focus:border-kawaii-purple"
                placeholder="Tono, ritmo, palabras favoritas, cercanía, coquetería, formalidad o informalidad."
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-kawaii-muted mb-1">Escenario persistente</label>
                <textarea
                  value={settings.characterProfile.scenario}
                  onChange={(e) => update({
                    characterProfile: {
                      ...settings.characterProfile,
                      scenario: e.target.value,
                    },
                  })}
                  rows={3}
                  className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs leading-relaxed focus:outline-none focus:border-kawaii-purple"
                  placeholder="Contexto base donde existe el personaje y desde dónde te responde."
                />
              </div>
              <div>
                <label className="block text-xs text-kawaii-muted mb-1">Reglas de conducta</label>
                <textarea
                  value={settings.characterProfile.behaviorRules}
                  onChange={(e) => update({
                    characterProfile: {
                      ...settings.characterProfile,
                      behaviorRules: e.target.value,
                    },
                  })}
                  rows={3}
                  className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs leading-relaxed focus:outline-none focus:border-kawaii-purple"
                  placeholder="Qué debe mantener siempre, qué evita, cómo reacciona ante ciertos temas."
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-kawaii-muted mb-1">Descripción visual del personaje (opcional)</label>
              <textarea
                value={settings.characterProfile.visualIdentityPrompt}
                onChange={(e) => update({
                  characterProfile: {
                    ...settings.characterProfile,
                    visualIdentityPrompt: e.target.value,
                  },
                })}
                rows={2}
                className="w-full bg-kawaii-surface border border-kawaii-surface-3 rounded-lg px-2 py-1.5 text-xs leading-relaxed focus:outline-none focus:border-kawaii-purple"
                placeholder="Rasgos visuales clave: peinado, color de ojos, estilo, paleta, accesorios, etc."
              />
            </div>

            <div className="space-y-2 rounded-lg border border-kawaii-surface-3 bg-kawaii-surface p-2.5">
              <input
                ref={characterImageInputRef}
                type="file"
                accept="image/*"
                onChange={onCharacterImageSelected}
                className="hidden"
              />

              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-kawaii-text">Imagen de perfil visual del personaje</span>
                <button
                  type="button"
                  onClick={() => characterImageInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-lg border border-kawaii-surface-3 bg-kawaii-surface-2 px-2 py-1 text-xs text-kawaii-text hover:bg-kawaii-surface-3"
                >
                  <Upload size={12} />
                  Cargar imagen
                </button>
              </div>

              {settings.characterProfile.profileImageDataUrl ? (
                <div className="space-y-2">
                  <img
                    src={settings.characterProfile.profileImageDataUrl}
                    alt={settings.characterProfile.profileImageName || 'Perfil del personaje'}
                    className="max-h-44 rounded-lg border border-kawaii-surface-3"
                  />
                  <div className="flex items-center justify-between gap-2 text-[11px] text-kawaii-dim">
                    <span className="truncate">{settings.characterProfile.profileImageName || 'Imagen cargada'}</span>
                    <button
                      type="button"
                      onClick={() => update({
                        characterProfile: {
                          ...settings.characterProfile,
                          profileImageDataUrl: '',
                          profileImageName: '',
                          profileImageMimeType: '',
                        },
                      })}
                      className="underline hover:text-kawaii-text"
                    >
                      Quitar
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-kawaii-dim leading-relaxed">
                  Sube una referencia visual del personaje para reforzar consistencia en generación de imágenes.
                </p>
              )}
            </div>

            <p className="text-[11px] text-kawaii-dim leading-relaxed">
              Este bloque se inserta en el prompt efectivo antes del prompt manual para hacer la personalidad más consistente y más real a lo largo de toda la conversación.
            </p>
          </section>

          {/* ── System prompt ───────────────────────────────────────────────── */}
          <section className="space-y-2">
            <label className="block text-sm font-bold text-kawaii-text">System Prompt</label>
            <textarea
              value={settings.systemPrompt}
              onChange={(e) => update({ systemPrompt: e.target.value })}
              rows={4}
              className="w-full bg-kawaii-surface-2 border border-kawaii-surface-3 rounded-lg px-3 py-2 text-sm leading-relaxed focus:outline-none focus:border-kawaii-purple"
            />
          </section>

          {/* ── Generation options ──────────────────────────────────────────── */}
          <section className="space-y-3">
            <div>
              <label className="block text-sm font-bold text-kawaii-text mb-1">Temperature: {settings.temperature.toFixed(2)}</label>
              <input
                type="range" min="0" max="1.5" step="0.05"
                value={settings.temperature}
                onChange={(e) => update({ temperature: Number(e.target.value) })}
                className="w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm text-kawaii-text col-span-2">
                <input type="checkbox" checked={settings.streamResponses}
                  onChange={(e) => update({ streamResponses: e.target.checked })} />
                Stream — mostrar tokens en tiempo real
              </label>
              <label className="flex items-center gap-2 text-sm text-kawaii-text col-span-2">
                <input type="checkbox" checked={settings.webSearchEnabled}
                  onChange={(e) => update({ webSearchEnabled: e.target.checked })} />
                Web search context en prompts de noticias/actualidad
              </label>
              <label className="flex items-center gap-2 text-sm text-kawaii-text col-span-2">
                <input type="checkbox" checked={settings.autoFailover}
                  onChange={(e) => update({ autoFailover: e.target.checked })} className="accent-kawaii-teal" />
                Auto-failover: si cloud falla, usar modelo local automáticamente
              </label>
              <label className="flex items-center gap-2 text-sm text-kawaii-text col-span-2">
                <input type="checkbox" checked={settings.prioritizeUnrestricted}
                  onChange={(e) => update({ prioritizeUnrestricted: e.target.checked })} className="accent-kawaii-pink" />
                Priorizar cero restricciones en ruteo inteligente
              </label>
              <label className="flex items-center gap-2 text-sm text-kawaii-text col-span-2">
                <input type="checkbox" checked={settings.preferFreeTier}
                  onChange={(e) => update({ preferFreeTier: e.target.checked })} className="accent-kawaii-purple" />
                Priorizar modelos gratis/rápidos cuando sea posible
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-kawaii-muted mb-1">Local Max Tokens</label>
                <input type="number" min="64" max="4096" value={settings.localMaxTokens}
                  onChange={(e) => update({ localMaxTokens: Number(e.target.value) || 400 })}
                  className="w-full bg-kawaii-surface-2 border border-kawaii-surface-3 rounded-lg px-2 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-kawaii-muted mb-1">Cloud Max Tokens</label>
                <input type="number" min="64" max="128000" value={settings.cloudMaxTokens}
                  onChange={(e) => update({ cloudMaxTokens: Number(e.target.value) || 1200 })}
                  className="w-full bg-kawaii-surface-2 border border-kawaii-surface-3 rounded-lg px-2 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-kawaii-muted mb-1">Long-prompt threshold (chars)</label>
                <input type="number" min="100" max="5000" value={settings.smartLongPromptThreshold}
                  onChange={(e) => update({ smartLongPromptThreshold: Number(e.target.value) || 700 })}
                  className="w-full bg-kawaii-surface-2 border border-kawaii-surface-3 rounded-lg px-2 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-kawaii-muted mb-1">Web search max results</label>
                <input type="number" min="1" max="10" value={settings.webSearchMaxResults}
                  onChange={(e) => update({ webSearchMaxResults: Number(e.target.value) || 5 })}
                  className="w-full bg-kawaii-surface-2 border border-kawaii-surface-3 rounded-lg px-2 py-2 text-sm" />
              </div>
            </div>
          </section>

          {/* ── Local user memory options ─────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-bold text-kawaii-text">Memoria local del usuario</label>
              <span className="text-xs text-kawaii-dim">
                {activeConversation ? `${activeMemory.length} dato(s) en chat activo` : 'Sin chat activo'}
              </span>
            </div>

            {!activeConversation ? (
              <p className="text-[11px] text-kawaii-dim leading-relaxed">
                Abre una conversación para ver y administrar su memoria local.
              </p>
            ) : activeMemory.length === 0 ? (
              <p className="text-[11px] text-kawaii-dim leading-relaxed">
                Aún no hay datos recordados en este chat. Se llenará automáticamente con información explícita del usuario.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="max-h-44 overflow-auto rounded-lg border border-kawaii-surface-3 bg-kawaii-surface-2 p-2">
                  <ul className="space-y-1.5">
                    {activeMemory.map(item => (
                      <li key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-kawaii-surface-3 px-2 py-1.5 text-xs">
                        <div className="min-w-0">
                          <div className="font-semibold text-kawaii-text truncate">{item.key}</div>
                          <div className="text-kawaii-dim truncate">{item.value}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeUserMemoryFact(activeConversation.id, item.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-kawaii-surface-3 px-2 py-1 text-[11px] text-kawaii-dim hover:text-kawaii-text hover:bg-kawaii-surface-3"
                        >
                          <Trash2 size={11} />
                          Borrar
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => clearUserMemory(activeConversation.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-kawaii-surface-3 bg-kawaii-surface px-2.5 py-1.5 text-xs text-kawaii-dim hover:text-kawaii-text hover:bg-kawaii-surface-2"
                  >
                    <Trash2 size={12} />
                    Borrar memoria del chat activo
                  </button>
                </div>
              </div>
            )}

            <p className="text-[11px] text-kawaii-dim leading-relaxed">
              Seguridad: esta memoria vive solo en local y se elimina automáticamente al limpiar o borrar la conversación.
            </p>

            <div className="rounded-lg border border-kawaii-surface-3 bg-kawaii-surface-2 p-2.5 space-y-2">
              <div className="text-xs font-semibold text-kawaii-text">Respaldo y carga de conversaciones</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={exportChatConversations}
                  className="inline-flex items-center gap-1 rounded-lg border border-kawaii-surface-3 bg-kawaii-surface px-2.5 py-1.5 text-xs text-kawaii-dim hover:text-kawaii-text hover:bg-kawaii-surface-3"
                >
                  <Download size={12} />
                  Exportar conversaciones
                </button>
                <button
                  type="button"
                  onClick={() => beginChatImport('merge')}
                  className="inline-flex items-center gap-1 rounded-lg border border-kawaii-surface-3 bg-kawaii-surface px-2.5 py-1.5 text-xs text-kawaii-dim hover:text-kawaii-text hover:bg-kawaii-surface-3"
                >
                  <Upload size={12} />
                  Importar (agregar)
                </button>
                <button
                  type="button"
                  onClick={() => beginChatImport('replace')}
                  className="inline-flex items-center gap-1 rounded-lg border border-kawaii-surface-3 bg-kawaii-surface px-2.5 py-1.5 text-xs text-kawaii-dim hover:text-kawaii-text hover:bg-kawaii-surface-3"
                >
                  <Upload size={12} />
                  Importar (reemplazar todo)
                </button>
              </div>
              {chatTransferNotice && (
                <p className="text-[11px] text-kawaii-dim leading-relaxed">{chatTransferNotice}</p>
              )}
              <input
                ref={chatImportInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={onChatImportFileSelected}
              />
            </div>

            <div className="rounded-lg border border-kawaii-surface-3 bg-kawaii-surface-2 p-2.5 space-y-2">
              <div className="text-xs font-semibold text-kawaii-text">Paridad DEV/PACKAGED: configuración de proveedores</div>
              <p className="text-[11px] text-kawaii-dim leading-relaxed">
                Exporta/importa endpoints, modelos y API keys para clonar exactamente la configuración entre entornos.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void exportProviderConfiguration()}
                  className="inline-flex items-center gap-1 rounded-lg border border-kawaii-surface-3 bg-kawaii-surface px-2.5 py-1.5 text-xs text-kawaii-dim hover:text-kawaii-text hover:bg-kawaii-surface-3"
                >
                  <Download size={12} />
                  Exportar config providers
                </button>
                <button
                  type="button"
                  onClick={beginProviderImport}
                  className="inline-flex items-center gap-1 rounded-lg border border-kawaii-surface-3 bg-kawaii-surface px-2.5 py-1.5 text-xs text-kawaii-dim hover:text-kawaii-text hover:bg-kawaii-surface-3"
                >
                  <Upload size={12} />
                  Importar config providers
                </button>
              </div>
              {providerTransferNotice && (
                <p className="text-[11px] text-kawaii-dim leading-relaxed">{providerTransferNotice}</p>
              )}
              <input
                ref={providerImportInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={onProviderImportFileSelected}
              />
            </div>
          </section>

          {/* ── Actions ─────────────────────────────────────────────────────── */}
          <section className="flex justify-between pt-2">
            <button
              onClick={() => { reset(); setApiKey(''); setAdditionalKeys({}); void setProviderApiKey('') }}
              className="px-3 py-2 rounded-lg bg-kawaii-surface-2 border border-kawaii-surface-3 text-kawaii-muted hover:text-kawaii-text"
            >
              Reset defaults
            </button>
            <button
              onClick={saveAndClose}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-kawaii-pink to-kawaii-purple text-white font-bold hover:opacity-90"
            >
              Save &amp; Close
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}

function ProviderCard({ icon, title, subtitle, active, onClick }: {
  icon: React.ReactNode; title: string; subtitle: string; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border px-3 py-3 transition-all ${
        active
          ? 'border-kawaii-pink bg-kawaii-surface-2 shadow-lg shadow-kawaii-pink/10'
          : 'border-kawaii-surface-3 bg-kawaii-surface hover:bg-kawaii-surface-2'
      }`}
    >
      <div className="flex items-center gap-2 text-kawaii-text font-bold text-sm">
        {icon}<span>{title}</span>
      </div>
      <p className="text-[11px] text-kawaii-dim mt-1 leading-relaxed">{subtitle}</p>
    </button>
  )
}
