import { useState, useCallback, useRef } from 'react'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { LegacyEngineClient, OpenAICompatibleClient, OllamaClient } from '@/services/aiClient'
import {
  getCatalogModelsForBaseUrl,
  getImageModelCandidatesForBaseUrl,
  pickSmartModelWithOptions,
  providerSupportsImageGeneration,
} from '@/services/cloudCatalog'
import { ensureLegacyRuntimeReady } from '@/services/legacyRuntime'
import { prependWebContext, selectRoute } from '@/services/smartRouting'
import { searchWeb } from '@/services/webSearch'
import { getProviderApiKey, getSecretKey } from '@/utils/secureSettings'
import { titleFromMessage } from '@/utils/formatters'
import { buildSystemPrompt } from '@/utils/systemPrompt'
import type { AIModel, CharacterProfile, ChatMessageInput, MessageAttachment, Settings } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CloudCfg {
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: number
  label: string
}

const SOFT_REFUSAL_ERR = 'SOFT_REFUSAL'
const STREAM_PARTIAL_UPDATE_MS = 48

// ── Pure helpers ──────────────────────────────────────────────────────────────

function stripPrefix(name: string): string {
  return name.replace(/^\[[^\]]+\]\s*/, '')
}

/** Detect HTTP 429, quota-exceeded, or rate-limit errors from any provider */
function isQuotaError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('quota') ||
    msg.includes('exceeded') ||
    msg.includes('insufficient_quota') ||
    msg.includes('too many requests') ||
    (msg.includes('token') && msg.includes('limit'))
  )
}

function isRetryableCloudError(err: unknown): boolean {
  if (isQuotaError(err)) return true
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes(SOFT_REFUSAL_ERR.toLowerCase()) ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('invalid api key') ||
    msg.includes('model') && msg.includes('not found') ||
    msg.includes('404') ||
    msg.includes('5') && msg.includes('provider error') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('fetch failed')
  )
}

function summarizeProviderError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const compact = msg.replace(/\s+/g, ' ').trim()
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact
}

function isImageModelNotFoundError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    (msg.includes('model') && msg.includes('not found')) ||
    msg.includes('resource not found') ||
    msg.includes('unable to access model') ||
    msg.includes('does not exist') ||
    msg.includes('404')
  )
}

function toFriendlyImageError(err: unknown): string {
  const raw = summarizeProviderError(err)
  const lower = raw.toLowerCase()
  if (isImageModelNotFoundError(raw)) {
    return 'Modelo de imagen no disponible en ese proveedor. Smart probó alternativas, pero no encontró una compatible.'
  }
  if (lower.includes('invalid api key') || lower.includes('401') || lower.includes('unauthorized')) {
    return 'API key inválida para el proveedor de imagen seleccionado.'
  }
  return raw
}

function shouldFlushStreamUpdate(chunk: string, lastUpdateAt: number): boolean {
  if (Date.now() - lastUpdateAt >= STREAM_PARTIAL_UPDATE_MS) return true
  return /[\n.!?]/.test(chunk)
}

function createStreamUpdateController(onPartial: (text: string) => void): {
  push: (accumulatedText: string, chunk: string) => void
  flush: (accumulatedText: string) => void
} {
  let lastUpdateAt = 0

  return {
    push(accumulatedText, chunk) {
      if (!shouldFlushStreamUpdate(chunk, lastUpdateAt)) return
      onPartial(accumulatedText)
      lastUpdateAt = Date.now()
    },
    flush(accumulatedText) {
      onPartial(accumulatedText)
      lastUpdateAt = Date.now()
    },
  }
}

function buildCharacterImageStyleInstruction(profile: CharacterProfile): string {
  if (!profile.enabled) return ''

  const chunks = [
    profile.name.trim() ? `Personaje: ${profile.name.trim()}.` : '',
    profile.identity.trim() ? `Identidad: ${profile.identity.trim()}.` : '',
    profile.personality.trim() ? `Personalidad: ${profile.personality.trim()}.` : '',
    profile.visualIdentityPrompt.trim() ? `Guía visual explícita: ${profile.visualIdentityPrompt.trim()}.` : '',
    'Mantén continuidad visual del personaje entre generaciones: rostro, peinado, paleta y vibra general coherentes.',
  ].filter(Boolean)

  return chunks.join(' ')
}

async function buildCharacterAwareImagePrompt(
  basePrompt: string,
  profile: CharacterProfile,
  queue: CloudCfg[],
): Promise<string> {
  const styleInstruction = buildCharacterImageStyleInstruction(profile)
  if (!styleInstruction) return basePrompt

  const composed = `${styleInstruction}\n\nPrompt del usuario: ${basePrompt}`
  if (!profile.profileImageDataUrl || queue.length === 0) return composed

  const cfg = queue[0]
  const imageAttachment: MessageAttachment = {
    id: 'character-profile-image',
    name: profile.profileImageName || 'character-profile.png',
    mimeType: profile.profileImageMimeType || 'image/png',
    size: 0,
    kind: 'image',
    dataUrl: profile.profileImageDataUrl,
  }

  try {
    const visionClient = new OpenAICompatibleClient(cfg.baseUrl, cfg.apiKey)
    const visualDescription = await visionClient.chat(
      cfg.model,
      [
        {
          role: 'user',
          content: 'Describe rasgos visuales concretos del personaje en la imagen (rostro, pelo, vestimenta, estilo, paleta). Responde en una sola línea útil para prompt de imagen.',
          attachments: [imageAttachment],
        },
      ],
      'Eres un analista visual de referencias de personaje. Entrega descripción breve, específica y usable para generación de imagen.',
      0.2,
      180,
    )

    const compactVisual = visualDescription.replace(/\s+/g, ' ').trim()
    if (!compactVisual) return composed

    return `${composed}\n\nReferencia visual de imagen de perfil: ${compactVisual}`
  } catch {
    return composed
  }
}

async function ensureLegacyClient(settings: Settings, apiKey: string): Promise<LegacyEngineClient> {
  const ready = await ensureLegacyRuntimeReady(settings, apiKey)
  if (!ready.ready) {
    const runtimeHint = ready.status?.lastError
      ? ` Último error runtime: ${ready.status.lastError}`
      : ''
    throw new Error(`Motor Kawaii no disponible. Revisa comando/cwd del runtime legacy o la URL base.${runtimeHint}`)
  }

  return new LegacyEngineClient(settings.legacyEngineBaseUrl, apiKey)
}

function extractStatusCode(message: string): number | undefined {
  const m = message.match(/\((\d{3})\)/)
  if (!m) return undefined
  const parsed = Number(m[1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function isLikelyPolicyRefusal(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('i cannot fulfill your request') ||
    lower.includes('i can\'t help with') ||
    lower.includes('i\'m not able to help with') ||
    lower.includes('no puedo ayudar con') ||
    lower.includes('no puedo cumplir tu solicitud') ||
    lower.includes('no puedo proporcionar')
  )
}

function isLikelyBenignPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase()
  return (
    lower.includes('imagen') ||
    lower.includes('image') ||
    lower.includes('codigo') ||
    lower.includes('código') ||
    lower.includes('explica') ||
    lower.includes('resume') ||
    lower.includes('traduce') ||
    lower.includes('plan')
  )
}

async function filterHealthyCloudProviders(queue: CloudCfg[]): Promise<CloudCfg[]> {
  const checks = await Promise.allSettled(
    queue.map(async cfg => {
      const ok = await new OpenAICompatibleClient(cfg.baseUrl, cfg.apiKey).checkConnection()
      return ok ? cfg : null
    }),
  )
  const healthy = checks
    .filter((r): r is PromiseFulfilledResult<CloudCfg | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((v): v is CloudCfg => Boolean(v))
  return healthy
}

function resolveProvider(
  modelName: string,
  models: AIModel[],
  fallbackUrl: string,
  fallbackKeyId: string,
): { baseUrl: string; keyId: string; actualModel: string } {
  const found = models.find(m => m.name === modelName)
  if (found?.providerBaseUrl) {
    return {
      baseUrl: found.providerBaseUrl,
      keyId: found.providerKeyId ?? fallbackKeyId,
      actualModel: stripPrefix(found.name),
    }
  }
  return { baseUrl: fallbackUrl, keyId: fallbackKeyId, actualModel: stripPrefix(modelName) }
}

/** Build ordered cloud provider queue: main first, then enabled additional providers */
async function buildCloudQueue(
  settings: Settings,
  models: AIModel[],
  mainApiKey: string,
  fallbackModel: string,
  prompt: string,
  maxTokens: number,
): Promise<CloudCfg[]> {
  const preferredCloudModel = settings.cloudModel || fallbackModel
  const { baseUrl, keyId } = resolveProvider(
    preferredCloudModel,
    models,
    settings.cloudBaseUrl,
    'providerApiKey',
  )

  const mainCandidates = models
    .filter(m => m.provider !== 'ollama' && m.providerBaseUrl === baseUrl)
    .map(m => stripPrefix(m.name))
  const mainPool = mainCandidates.length > 0 ? mainCandidates : getCatalogModelsForBaseUrl(baseUrl)
  const actualModel = pickSmartModelWithOptions(prompt, mainPool, preferredCloudModel, {
    prioritizeUnrestricted: settings.prioritizeUnrestricted,
    preferFreeTier: settings.preferFreeTier,
  })

  const mainKey = keyId === 'providerApiKey' ? mainApiKey : await getSecretKey(keyId)

  const queue: CloudCfg[] = []
  if (mainKey.trim()) {
    queue.push({ baseUrl, apiKey: mainKey, model: actualModel, maxTokens, label: `cloud • ${actualModel}` })
  }

  for (const ap of (settings.additionalProviders ?? []).filter(p => p.enabled && p.baseUrl)) {
    const apKey = await getSecretKey(`ap_${ap.id}_key`)
    if (!apKey.trim()) continue

    const apCandidates = models
      .filter(m => m.provider !== 'ollama' && m.providerBaseUrl === ap.baseUrl)
      .map(m => stripPrefix(m.name))
    const apPool = apCandidates.length > 0 ? apCandidates : getCatalogModelsForBaseUrl(ap.baseUrl)
    const apModel = pickSmartModelWithOptions(prompt, apPool, preferredCloudModel, {
      prioritizeUnrestricted: settings.prioritizeUnrestricted,
      preferFreeTier: settings.preferFreeTier,
    })

    queue.push({
      baseUrl: ap.baseUrl,
      apiKey: apKey,
      model: apModel,
      maxTokens,
      label: `${ap.name || ap.id} • ${apModel}`,
    })
  }

  return queue
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChat(models: AIModel[] = []) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { activeId, addMessage, updateMessage, create, rename } = useChatStore()
  const { settings, update: updateSettings } = useSettingsStore()

  const sendMessage = useCallback(async (content: string, attachments: MessageAttachment[] = []): Promise<void> => {
    const text = content.trim()
    if ((!text && attachments.length === 0) || isLoading) return

    setError(null)

    const model = settings.defaultModel || settings.legacyModel || settings.cloudModel || settings.localModel || models[0]?.name || 'auto-smart'
    if (!model && settings.provider !== 'smart') {
      setError('Sin modelo seleccionado. Abre Ajustes ⚙️ y añade una API key.')
      return
    }

    let convId = activeId
    if (!convId) convId = create(model)

    addMessage(convId, { role: 'user', content: text, attachments, timestamp: Date.now() })

    const conv = useChatStore.getState().conversations.find(c => c.id === convId)
    if (conv && conv.messages.length === 1) {
      rename(convId, titleFromMessage(text || attachments[0]?.name || 'Nuevo chat'))
    }

    const apiMessages: ChatMessageInput[] = (
      useChatStore.getState().conversations.find(c => c.id === convId)?.messages ?? []
    ).map(m => ({ role: m.role, content: m.content, attachments: m.attachments }))

    const assistantId = addMessage(convId, {
      role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true,
    })

    setIsLoading(true)
    abortRef.current = new AbortController()

    const routePrompt = text || attachments.map(attachment => attachment.name).join(' ')
    let apiKey = ''
    let decision: ReturnType<typeof selectRoute>
    let sysPrompt = ''
    let cloudQueue: CloudCfg[] = []

    try {
      apiKey = await getProviderApiKey()
      decision = selectRoute(settings, routePrompt)
      sysPrompt = buildSystemPrompt(settings.systemPrompt, settings.characterProfile)
      const builtCloudQueue = await buildCloudQueue(settings, models, apiKey, model, routePrompt, decision.maxTokens)
      const healthyCloudQueue = await filterHealthyCloudProviders(builtCloudQueue)
      cloudQueue = healthyCloudQueue.length > 0 ? healthyCloudQueue : builtCloudQueue
    } catch (err) {
      const msg = summarizeProviderError(err)
      setError(msg)
      updateMessage(convId, assistantId, `⚠️ ${msg}`, false)
      setIsLoading(false)
      return
    }

    const smartShouldPreferCloud = (() => {
      if (settings.provider !== 'smart' || cloudQueue.length === 0) return false
      const lower = routePrompt.toLowerCase()
      if (lower.length < 28 && /hola|hey|gracias|ok|vale/.test(lower)) return false
      return true
    })()

    const target = smartShouldPreferCloud ? 'cloud' : decision.target

    // ── Image generation branch ───────────────────────────────────────────────
    if (decision.generateImage && settings.imageGenEnabled) {
      updateMessage(convId, assistantId, 'Generando imagen... ✨', true)
      try {
        const queue = await buildCloudQueue(settings, models, apiKey, model, routePrompt, decision.maxTokens)
        if (queue.length === 0) throw new Error('No hay proveedor cloud con API key para generar imágenes.')
        const characterAwarePrompt = await buildCharacterAwareImagePrompt(
          decision.imagePrompt,
          settings.characterProfile,
          queue,
        )

        let lastError: string | null = null

        for (let idx = 0; idx < queue.length; idx++) {
          const cfg = queue[idx]
          if (!providerSupportsImageGeneration(cfg.baseUrl)) {
            lastError = `${cfg.label}: proveedor sin endpoint de imagen compatible`
            if (idx < queue.length - 1) {
              const next = queue[idx + 1]
              updateMessage(
                convId,
                assistantId,
                `⚡ ${cfg.label}: sin soporte de imagen → rotando a ${next.label}...`,
                true,
              )
              continue
            }
            break
          }

          const imageModels = getImageModelCandidatesForBaseUrl(
            cfg.baseUrl,
            settings.imageGenAutoSelect ? '' : settings.imageGenModel,
          )
          if (imageModels.length === 0) {
            lastError = `${cfg.label}: sin modelos de imagen compatibles`
            if (idx < queue.length - 1) {
              const next = queue[idx + 1]
              updateMessage(
                convId,
                assistantId,
                `⚡ ${cfg.label}: sin modelos de imagen compatibles → rotando a ${next.label}...`,
                true,
              )
              continue
            }
            break
          }

          let rotateProvider = false

          for (let modelIdx = 0; modelIdx < imageModels.length; modelIdx++) {
            const imageModel = imageModels[modelIdx]

            try {
              const imgClient = new OpenAICompatibleClient(cfg.baseUrl, cfg.apiKey)
              const imageUrl = await imgClient.generateImage(characterAwarePrompt, imageModel)
              updateMessage(
                convId,
                assistantId,
                `Imagen generada: *"${decision.imagePrompt}"*${settings.characterProfile.enabled ? ' con perfil visual de personaje' : ''}`,
                false,
                imageUrl,
                `imagen • ${cfg.label} • ${imageModel}`,
              )
              updateSettings({ cloudDiagnostics: null })
              setIsLoading(false)
              return
            } catch (err) {
              const errMsg = summarizeProviderError(err)
              lastError = errMsg

              updateSettings({
                cloudDiagnostics: {
                  lastProvider: `imagen • ${cfg.label} • ${imageModel}`,
                  lastError: errMsg,
                  lastAt: Date.now(),
                  attempt: idx + 1,
                  total: queue.length,
                  code: extractStatusCode(errMsg),
                },
              })

              if (isImageModelNotFoundError(err) && modelIdx < imageModels.length - 1) {
                const nextModel = imageModels[modelIdx + 1]
                updateMessage(
                  convId,
                  assistantId,
                  `⚡ ${cfg.label}: modelo ${imageModel} no disponible → probando ${nextModel}...`,
                  true,
                )
                continue
              }

              if (isRetryableCloudError(err) && idx < queue.length - 1) {
                const next = queue[idx + 1]
                updateMessage(
                  convId,
                  assistantId,
                  `⚡ ${cfg.label}: ${errMsg} → rotando a ${next.label} para imagen...`,
                  true,
                )
                rotateProvider = true
                break
              }

              break
            }
          }

          if (rotateProvider) {
            continue
          }

          break
        }

        throw new Error(lastError ?? 'No se pudo generar la imagen con los proveedores cloud disponibles.')
      } catch (err) {
        const msg = toFriendlyImageError(err)
        updateSettings({
          cloudDiagnostics: {
            lastProvider: `imagen • ${settings.imageGenModel}`,
            lastError: msg,
            lastAt: Date.now(),
            attempt: 1,
            total: 1,
            code: extractStatusCode(msg),
          },
        })
        setError(msg)
        updateMessage(convId, assistantId, `⚠️ ${msg}`, false)
      } finally {
        setIsLoading(false)
      }
      return
    }

    // ── Web search context ────────────────────────────────────────────────────
    let effectiveMessages: ChatMessageInput[] = apiMessages
    if (decision.useWebSearch) {
      try {
        const web = await searchWeb(text, settings.webSearchMaxResults)
        effectiveMessages = prependWebContext(apiMessages, web)
      } catch { /* continue without web context */ }
    }

    // ── Legacy engine mode ────────────────────────────────────────────────────
    if (settings.provider === 'legacy-engine' || target === 'legacy') {
      const legacyModel = stripPrefix(settings.legacyModel || model || 'legacy-default')
      const legacyClient = await ensureLegacyClient(settings, apiKey)
      try {
        if (settings.streamResponses) {
          let acc = ''
          const streamUi = createStreamUpdateController((partial) => {
            updateMessage(convId!, assistantId, partial, true)
          })
          for await (const chunk of legacyClient.streamChat(
            legacyModel, effectiveMessages, sysPrompt,
            decision.temperature, settings.cloudMaxTokens, abortRef.current!.signal,
          )) {
            acc += chunk
            streamUi.push(acc, chunk)
          }
          streamUi.flush(acc)
          updateMessage(convId!, assistantId, acc, false, undefined, `kawaii • ${legacyModel}`)
        } else {
          const r = await legacyClient.chat(
            legacyModel, effectiveMessages, sysPrompt, decision.temperature, settings.cloudMaxTokens,
          )
          updateMessage(convId!, assistantId, r, false, undefined, `kawaii • ${legacyModel}`)
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          const partial = useChatStore.getState()
            .conversations.find(c => c.id === convId)
            ?.messages.find(m => m.id === assistantId)?.content ?? ''
          updateMessage(convId, assistantId, partial, false)
          setIsLoading(false)
          return
        }

        const msg = err instanceof Error ? err.message : String(err)

        if (settings.provider === 'smart' && settings.autoFailover && settings.localModel) {
          const localModel = stripPrefix(settings.localModel)
          const localClient = new OllamaClient(settings.localBaseUrl)
          updateMessage(convId!, assistantId, `⚠️ Kawaii no disponible (${msg}) → usando modelo local...`, true)
          try {
            if (settings.streamResponses) {
              let acc = ''
              const streamUi = createStreamUpdateController((partial) => {
                updateMessage(convId!, assistantId, partial, true)
              })
              for await (const chunk of localClient.streamChat(
                localModel, effectiveMessages, sysPrompt,
                decision.temperature, settings.localMaxTokens, abortRef.current!.signal,
              )) {
                acc += chunk
                streamUi.push(acc, chunk)
              }
              streamUi.flush(acc)
              updateMessage(convId!, assistantId, acc, false, undefined, `local (fallback) • ${localModel}`)
            } else {
              const r = await localClient.chat(
                localModel, effectiveMessages, sysPrompt, decision.temperature, settings.localMaxTokens,
              )
              updateMessage(convId!, assistantId, r, false, undefined, `local (fallback) • ${localModel}`)
            }
          } catch (fbErr) {
            const fbMsg = summarizeProviderError(fbErr)
            setError(fbMsg)
            updateMessage(convId!, assistantId, `⚠️ ${fbMsg}`, false)
          } finally {
            setIsLoading(false)
          }
          return
        }

        setError(msg)
        updateMessage(convId, assistantId, `⚠️ ${msg}`, false)
      } finally {
        setIsLoading(false)
      }
      return
    }

    // ── Local mode (Ollama) ───────────────────────────────────────────────────
    if (target === 'local') {
      const localModel = stripPrefix(settings.localModel || model)
      const localClient = new OllamaClient(settings.localBaseUrl)
      try {
        if (settings.streamResponses) {
          let acc = ''
          const streamUi = createStreamUpdateController((partial) => {
            updateMessage(convId!, assistantId, partial, true)
          })
          for await (const chunk of localClient.streamChat(
            localModel, effectiveMessages, sysPrompt,
            decision.temperature, settings.localMaxTokens, abortRef.current!.signal,
          )) {
            acc += chunk
            streamUi.push(acc, chunk)
          }
          streamUi.flush(acc)
          updateMessage(convId!, assistantId, acc, false, undefined, `local • ${localModel}`)
        } else {
          const r = await localClient.chat(
            localModel, effectiveMessages, sysPrompt, decision.temperature, settings.localMaxTokens,
          )
          updateMessage(convId!, assistantId, r, false, undefined, `local • ${localModel}`)
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          const partial = useChatStore.getState()
            .conversations.find(c => c.id === convId)
            ?.messages.find(m => m.id === assistantId)?.content ?? ''
          updateMessage(convId, assistantId, partial, false)
          setIsLoading(false)
          return
        }
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        updateMessage(convId, assistantId, `⚠️ ${msg}`, false)
      } finally {
        setIsLoading(false)
      }
      return
    }

    // ── Cloud mode with automatic provider rotation ───────────────────────────
    if (cloudQueue.length === 0) {
      const notice = '⚠️ Sin proveedor cloud disponible. Revisa API keys, endpoint y modelo en Ajustes ⚙️.'
      updateSettings({
        cloudDiagnostics: {
          lastProvider: 'cloud-queue',
          lastError: notice,
          lastAt: Date.now(),
          attempt: 0,
          total: 0,
        },
      })
      setError(notice)
      updateMessage(convId, assistantId, notice, false)
      setIsLoading(false)
      return
    }

    for (let idx = 0; idx < cloudQueue.length; idx++) {
      const cfg = cloudQueue[idx]
      const cloudClient = new OpenAICompatibleClient(cfg.baseUrl, cfg.apiKey)

      try {
        if (settings.streamResponses) {
          let acc = ''
          const streamUi = createStreamUpdateController((partial) => {
            updateMessage(convId!, assistantId, partial, true)
          })
          for await (const chunk of cloudClient.streamChat(
            cfg.model, effectiveMessages, sysPrompt,
            decision.temperature, cfg.maxTokens, abortRef.current!.signal,
          )) {
            acc += chunk
            streamUi.push(acc, chunk)
          }
          streamUi.flush(acc)
          if (isLikelyPolicyRefusal(acc) && isLikelyBenignPrompt(routePrompt) && idx < cloudQueue.length - 1) {
            throw new Error(`${SOFT_REFUSAL_ERR}: respuesta bloqueada en prompt benigno`)
          }
          updateMessage(convId!, assistantId, acc, false, undefined, cfg.label)
        } else {
          const r = await cloudClient.chat(
            cfg.model, effectiveMessages, sysPrompt, decision.temperature, cfg.maxTokens,
          )
          if (isLikelyPolicyRefusal(r) && isLikelyBenignPrompt(routePrompt) && idx < cloudQueue.length - 1) {
            throw new Error(`${SOFT_REFUSAL_ERR}: respuesta bloqueada en prompt benigno`)
          }
          updateMessage(convId!, assistantId, r, false, undefined, cfg.label)
        }
        updateSettings({ cloudDiagnostics: null })
        setIsLoading(false)
        return // ✓ success

      } catch (err) {
        // Abort → preserve partial content
        if ((err as Error).name === 'AbortError') {
          const partial = useChatStore.getState()
            .conversations.find(c => c.id === convId)
            ?.messages.find(m => m.id === assistantId)?.content ?? ''
          updateMessage(convId, assistantId, partial, false)
          setIsLoading(false)
          return
        }

        const errMsg = summarizeProviderError(err)
        updateSettings({
          cloudDiagnostics: {
            lastProvider: cfg.label,
            lastError: errMsg,
            lastAt: Date.now(),
            attempt: idx + 1,
            total: cloudQueue.length,
            code: extractStatusCode(errMsg),
          },
        })

        // Retryable cloud error → rotate to next provider in queue
        if (isRetryableCloudError(err) && idx < cloudQueue.length - 1) {
          const next = cloudQueue[idx + 1]
          updateMessage(
            convId!, assistantId,
            `⚡ ${cfg.label}: ${errMsg} → rotando a ${next.label}...`,
            true,
          )
          continue
        }

        // All cloud providers exhausted or non-quota error → kawaii/local auto-failover
        if (settings.enableLegacyEngine && settings.legacyModel) {
          const legacyModel = stripPrefix(settings.legacyModel)
          updateMessage(convId!, assistantId, `⚠️ Nube sin disponibilidad (${errMsg}) → probando motor Kawaii...`, true)
          try {
            const legacyClient = await ensureLegacyClient(settings, apiKey)
            if (settings.streamResponses) {
              let acc = ''
              const streamUi = createStreamUpdateController((partial) => {
                updateMessage(convId!, assistantId, partial, true)
              })
              for await (const chunk of legacyClient.streamChat(
                legacyModel, effectiveMessages, sysPrompt,
                decision.temperature, settings.cloudMaxTokens, abortRef.current!.signal,
              )) {
                acc += chunk
                streamUi.push(acc, chunk)
              }
              streamUi.flush(acc)
              updateMessage(convId!, assistantId, acc, false, undefined, `kawaii (fallback) • ${legacyModel}`)
            } else {
              const r = await legacyClient.chat(
                legacyModel, effectiveMessages, sysPrompt, decision.temperature, settings.cloudMaxTokens,
              )
              updateMessage(convId!, assistantId, r, false, undefined, `kawaii (fallback) • ${legacyModel}`)
            }
            setIsLoading(false)
            return
          } catch (legacyErr) {
            const legacyMsg = summarizeProviderError(legacyErr)
            updateSettings({
              cloudDiagnostics: {
                lastProvider: `kawaii • ${legacyModel}`,
                lastError: legacyMsg,
                lastAt: Date.now(),
                attempt: idx + 1,
                total: cloudQueue.length + 1,
              },
            })
          }
        }

        if (settings.autoFailover && settings.localModel) {
          const localModel = stripPrefix(settings.localModel)
          const localClient = new OllamaClient(settings.localBaseUrl)
          updateMessage(convId!, assistantId, `⚠️ Nube sin disponibilidad (${errMsg}) → usando modelo local...`, true)
          try {
            if (settings.streamResponses) {
              let acc = ''
              const streamUi = createStreamUpdateController((partial) => {
                updateMessage(convId!, assistantId, partial, true)
              })
              for await (const chunk of localClient.streamChat(
                localModel, effectiveMessages, sysPrompt,
                decision.temperature, settings.localMaxTokens, abortRef.current!.signal,
              )) {
                acc += chunk
                streamUi.push(acc, chunk)
              }
              streamUi.flush(acc)
              updateMessage(convId!, assistantId, acc, false, undefined, `local (fallback) • ${localModel}`)
            } else {
              const r = await localClient.chat(
                localModel, effectiveMessages, sysPrompt, decision.temperature, settings.localMaxTokens,
              )
              updateMessage(convId!, assistantId, r, false, undefined, `local (fallback) • ${localModel}`)
            }
          } catch (fbErr) {
            const fbMsg = summarizeProviderError(fbErr)
            setError(fbMsg)
            updateMessage(convId!, assistantId, `⚠️ ${fbMsg}`, false)
          }
          setIsLoading(false)
          return
        }

        const msg = summarizeProviderError(err)
        setError(msg)
        updateMessage(convId, assistantId, `⚠️ ${msg}`, false)
        setIsLoading(false)
        return
      }
    }

    setIsLoading(false)
  }, [isLoading, activeId, settings, models, addMessage, updateMessage, create, rename, updateSettings])

  const stopStreaming = useCallback((): void => {
    abortRef.current?.abort()
  }, [])

  return { sendMessage, stopStreaming, isLoading, error, clearError: () => setError(null) }

}
