import { useState, useCallback, useRef } from 'react'
import { useDiagnosticChat } from './DiagnosticChat'
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
import { analyzeErrorMessage, appendErrorLog, createErrorLogEntry, updateErrorKnowledgeBase } from '@/services/errorDiagnostics'
import { prependWebContext, selectRoute } from '@/services/smartRouting'
import { extractImportantUserFacts, prependUserMemoryContext } from '@/services/userMemory'
import { searchWeb } from '@/services/webSearch'
import {
  computeQuotaRetryMaxTokens,
  computeSafeContextCharsFromPromptLimit,
  derivePromptLimitFromRecentErrors,
  deriveTokenCapFromRecentErrors,
} from '@/services/chatResilience'
import { addChatTraceEvent, finishChatTrace, startChatTrace, type ChatTraceStatus } from '@/services/chatTrace'
import { estimateTokensFromChars } from '@/services/tokenBudget'
import { computeChatRequestBudget } from '@/services/chatRequestBudget'
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
const STREAM_PARTIAL_UPDATE_MS = 90
const LOCAL_CONFLICT_WINDOW_MS = 10 * 60_000
const LEGACY_CONFLICT_WINDOW_MS = 10 * 60_000
const CLOUD_HEALTH_WINDOW_MS = 12 * 60 * 60_000
const CLOUD_FAILURE_WINDOW_MS = 30 * 60_000
const CLOUD_PROVIDER_ATTEMPT_TIMEOUT_MS = 28_000
const CHAT_TIMEOUT_MS = 110_000
const LOCAL_PROVIDER_ATTEMPT_TIMEOUT_MS = 28_000
const CLOUD_CONTEXT_BUDGET_CHARS = 28_000
const LOCAL_CONTEXT_BUDGET_CHARS = 18_000
const CONTEXT_BUDGET_MAX_MESSAGES = 16
const ROTATION_JITTER_MIN_MS = 120
const ROTATION_JITTER_MAX_MS = 450
const CLOUD_CONNECTIVITY_FRESH_MS = 20 * 60_000
const SMART_MAX_CLOUD_ATTEMPTS = 2
const MANUAL_CLOUD_MAX_ATTEMPTS = 3
const DEFAULT_CONSERVATIVE_CLOUD_PROMPT_LIMIT = 2_400
const DEFAULT_OPENROUTER_FREE_PROMPT_LIMIT = 1_900

/**
 * Session-level blacklist for providers with fatal errors (auth/quota/model).
 * Module-level: cleared on app restart, shared between hook instances and SettingsModal.
 */
export const sessionBlacklistedProviders = new Set<string>()

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
    msg.includes('too many requests')
  )
}

function isContextTooLargeError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('prompt tokens limit exceeded') ||
    msg.includes('maximum context length') ||
    msg.includes('context length exceeded') ||
    msg.includes('input is too long') ||
    msg.includes('reduce your prompt') ||
    (msg.includes('token') && msg.includes('limit') && msg.includes('prompt'))
  )
}

function isRetryableCloudError(err: unknown): boolean {
  if (isContextTooLargeError(err)) return false
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

/**
 * Returns true for errors that will not resolve with a retry to the same provider:
 * auth (401), quota (402), forbidden (403), model-not-found (404).
 * Does NOT include timeouts or transient network errors.
 */
function isFatalProviderError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (isContextTooLargeError(err)) return false
  return (
    msg.includes('401') ||
    msg.includes('unauthorized') ||
    msg.includes('invalid api key') ||
    msg.includes('no valid api key') ||
    msg.includes('402') ||
    msg.includes('credit limit') ||
    msg.includes('insufficient_quota') ||
    (msg.includes('404') && (msg.includes('model') || msg.includes('endpoint') || msg.includes('no endpoints'))) ||
    (msg.includes('403') && !msg.includes('timeout'))
  )
}

function inferPromptLimitFromCloudQueue(queue: CloudCfg[], preferFreeTier: boolean): number {
  const hasOpenRouter = queue.some(item => item.baseUrl.toLowerCase().includes('openrouter.ai'))
  if (hasOpenRouter && preferFreeTier) return DEFAULT_OPENROUTER_FREE_PROMPT_LIMIT
  if (hasOpenRouter) return 2_800
  return DEFAULT_CONSERVATIVE_CLOUD_PROMPT_LIMIT
}

function estimateContextChars(message: ChatMessageInput): number {
  const base = (message.content || '').length
  const attachments = (message.attachments ?? []).reduce((acc, attachment) => {
    const extracted = attachment.extractedText?.length ?? 0
    const preview = attachment.previewText?.length ?? 0
    const meta = attachment.name.length + attachment.mimeType.length + 64
    return acc + Math.max(extracted, preview, meta)
  }, 0)
  return base + attachments
}

function trimMessagesForBudget(messages: ChatMessageInput[], budgetChars: number, maxMessages: number): ChatMessageInput[] {
  if (messages.length === 0) return messages

  const recent = messages.slice(-maxMessages)
  const droppedOlder = messages.slice(0, Math.max(0, messages.length - recent.length))
  const reversedKept: ChatMessageInput[] = []
  let used = 0
  let cutIndex = -1

  for (let i = recent.length - 1; i >= 0; i--) {
    const message = recent[i]
    const available = budgetChars - used
    if (available <= 240) {
      cutIndex = i
      break
    }

    let content = message.content || ''
    if (content.length > available) {
      const keptTail = Math.max(220, available - 40)
      content = `[contexto recortado]\n${content.slice(-keptTail)}`
    }

    const keepAttachments = i >= recent.length - 2
    const normalized: ChatMessageInput = keepAttachments
      ? { ...message, content }
      : { role: message.role, content }

    used += estimateContextChars(normalized)
    reversedKept.push(normalized)
  }

  const kept = reversedKept.reverse()
  const droppedRecent = cutIndex >= 0 ? recent.slice(0, cutIndex + 1) : []
  const dropped = [...droppedOlder, ...droppedRecent]

  if (dropped.length > 0) {
    const availableForSummary = Math.max(0, budgetChars - used)
    const compacted = buildCompactedHistoryMessage(dropped, availableForSummary)
    if (compacted) {
      kept.unshift(compacted)
      used += estimateContextChars(compacted)
    }
  }

  const latest = recent[recent.length - 1]
  const tail = kept[kept.length - 1]
  if (!tail || tail.role !== latest.role || tail.content !== latest.content) {
    kept.push({ ...latest })
  }

  return kept
}

function summarizeCompactLine(content: string, maxChars = 180): string {
  const normalized = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return ''

  const pieces = normalized
    .split(/(?<=[.!?])\s+|\n+/)
    .map(piece => piece.trim())
    .filter(Boolean)

  const keywords = [
    'importante', 'error', 'timeout', 'token', 'objetivo', 'necesito', 'quiero', 'prefiero',
    'recuerda', 'gusta', 'nombre', 'vivo', 'trabajo', 'config', 'modelo', 'proveedor',
  ]

  const scored = pieces
    .map((piece, idx) => {
      const lower = piece.toLowerCase()
      const score = keywords.reduce((acc, key) => acc + (lower.includes(key) ? 1 : 0), 0) + (idx === 0 ? 0.2 : 0)
      return { piece, score }
    })
    .sort((a, b) => b.score - a.score)

  const top = scored.slice(0, 2).map(item => item.piece).join(' ')
  const fallback = pieces[0] ?? normalized
  const line = (top || fallback).replace(/\s+/g, ' ').trim()
  return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line
}

function buildCompactedHistoryMessage(messages: ChatMessageInput[], availableChars: number): ChatMessageInput | null {
  if (availableChars < 260 || messages.length === 0) return null

  const maxItems = Math.min(8, Math.max(3, Math.floor(availableChars / 120)))
  const selected = messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .slice(-maxItems)

  const lines: string[] = []
  for (const message of selected) {
    const summary = summarizeCompactLine(message.content, 170)
    if (!summary) continue
    const roleLabel = message.role === 'assistant' ? 'Asistente' : 'Usuario'
    lines.push(`- ${roleLabel}: ${summary}`)
  }

  if (lines.length === 0) return null

  const header = 'Resumen compacto del historial anterior (preserva contexto importante):'
  let content = `${header}\n${lines.join('\n')}`

  if (content.length > availableChars) {
    const allowedLines = Math.max(2, Math.floor((availableChars - header.length - 20) / 80))
    content = `${header}\n${lines.slice(-allowedLines).join('\n')}`
  }

  if (content.length > availableChars) {
    content = `${content.slice(0, Math.max(120, availableChars - 1))}…`
  }

  return {
    role: 'user',
    content,
  }
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

function hasRecentLocalRuntimeConflict(settings: Settings): boolean {
  const logs = settings.errorLogs ?? []
  if (logs.length === 0) return false

  let transientLocalFails = 0

  const hasHardConflict = logs.some(entry => {
    if (!entry.at || Date.now() - entry.at > LOCAL_CONFLICT_WINDOW_MS) return false
    const route = (entry.route ?? '').toLowerCase()
    if (!(route === 'local' || route.includes('->local'))) return false

    const msg = (entry.message ?? '').toLowerCase()
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('failed to fetch') || msg.includes('econnrefused')) {
      transientLocalFails += 1
    }

    return (
      msg.includes('memory layout cannot be allocated') ||
      msg.includes('out of memory') ||
      msg.includes('cannot allocate')
    )
  })

  return hasHardConflict || transientLocalFails >= 2
}

function hasRecentLegacyConflict(settings: Settings): boolean {
  const logs = settings.errorLogs ?? []
  if (logs.length === 0) return false

  const recentLegacyFailures = logs.filter(entry => {
    if (!entry.at || Date.now() - entry.at > LEGACY_CONFLICT_WINDOW_MS) return false
    const route = (entry.route ?? '').toLowerCase()
    if (!(route === 'legacy' || route.includes('->legacy'))) return false

    const msg = (entry.message ?? '').toLowerCase()
    return (
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('failed to fetch') ||
      msg.includes('econnrefused') ||
      msg.includes('no disponible')
    )
  })

  return recentLegacyFailures.length >= 2
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

function createProviderAttemptAbort(baseSignal: AbortSignal, timeoutMs: number): {
  signal: AbortSignal
  wasTimedOut: () => boolean
  clear: () => void
} {
  const controller = new AbortController()
  let timedOut = false

  const timeoutId = window.setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('Provider timeout', 'AbortError'))
  }, timeoutMs)

  const onBaseAbort = () => {
    controller.abort(baseSignal.reason)
  }

  baseSignal.addEventListener('abort', onBaseAbort, { once: true })

  return {
    signal: controller.signal,
    wasTimedOut: () => timedOut,
    clear: () => {
      window.clearTimeout(timeoutId)
      baseSignal.removeEventListener('abort', onBaseAbort)
    },
  }
}

async function withAbortableTimeout<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new DOMException('Provider timeout', 'AbortError'))
    }, timeoutMs)

    const onAbort = () => {
      window.clearTimeout(timeoutId)
      reject(new DOMException('Provider timeout', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort, { once: true })

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => {
        window.clearTimeout(timeoutId)
        signal.removeEventListener('abort', onAbort)
      })
  })
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

function buildCharacterContextMessage(profile: CharacterProfile, includeImageAttachment: boolean): ChatMessageInput | null {
  if (!profile.enabled) return null

  const lines = [
    'Contexto interno del personaje activo (inyectado por la app).',
    profile.name.trim() ? `Nombre: ${profile.name.trim()}` : '',
    profile.identity.trim() ? `Identidad: ${profile.identity.trim()}` : '',
    profile.personality.trim() ? `Personalidad: ${profile.personality.trim()}` : '',
    profile.speakingStyle.trim() ? `Estilo al hablar: ${profile.speakingStyle.trim()}` : '',
    profile.relationship.trim() ? `Relacion con el usuario: ${profile.relationship.trim()}` : '',
    profile.visualIdentityPrompt.trim() ? `Guia visual: ${profile.visualIdentityPrompt.trim()}` : '',
    'Debes responder desde el primer mensaje como este personaje y mantener continuidad visual/persona.',
    'No digas que no puedes ver la apariencia configurada cuando el contexto de personaje este activo.',
  ].filter(Boolean)

  const baseMessage: ChatMessageInput = {
    role: 'user',
    content: lines.join('\n'),
  }

  if (!includeImageAttachment || !profile.profileImageDataUrl.trim()) {
    return baseMessage
  }

  const imageAttachment: MessageAttachment = {
    id: 'character-profile-context-image',
    name: profile.profileImageName || 'character-profile.png',
    mimeType: profile.profileImageMimeType || 'image/png',
    size: 0,
    kind: 'image',
    dataUrl: profile.profileImageDataUrl,
  }

  return {
    ...baseMessage,
    attachments: [imageAttachment],
  }
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
  return queue
}

function extractBaseUrlFromConnectivityLabel(label: string): string {
  const match = label.match(/\((https?:\/\/[^)]+)\)/i)
  return (match?.[1] ?? '').trim()
}

function isProviderMatch(providerText: string, cfg: CloudCfg): boolean {
  const lower = providerText.toLowerCase()
  const shortLabel = cfg.label.split(' • ')[0].toLowerCase()
  return lower.includes(cfg.baseUrl.toLowerCase()) || lower.includes(shortLabel)
}

function getNetworkRttMs(): number {
  const nav = navigator as unknown as { connection?: { rtt?: number } }
  const rtt = Number(nav.connection?.rtt ?? 0)
  return Number.isFinite(rtt) && rtt > 0 ? rtt : 0
}

function getProviderLatencyMs(settings: Settings, baseUrl?: string): number {
  const target = (baseUrl ?? '').toLowerCase()
  if (!target) return 0
  const now = Date.now()
  const connectivity = settings.cloudConnectivity ?? []
  const sample = connectivity.find(item => {
    if (!item.checkedAt || now - item.checkedAt > CLOUD_HEALTH_WINDOW_MS) return false
    const extracted = extractBaseUrlFromConnectivityLabel(item.label).toLowerCase()
    return extracted === target
  })
  return sample?.latencyMs ?? 0
}

function computeAdaptiveProviderTimeoutMs(
  settings: Settings,
  baseUrl?: string,
  contextChars = 0,
  maxTokens = 0,
): number {
  let timeoutMs = CLOUD_PROVIDER_ATTEMPT_TIMEOUT_MS
  const providerLatency = getProviderLatencyMs(settings, baseUrl)
  const rtt = getNetworkRttMs()

  if (providerLatency >= 800) timeoutMs += 4_000
  if (providerLatency >= 1_500) timeoutMs += 8_000
  if (providerLatency >= 2_500) timeoutMs += 8_000

  if (rtt >= 300) timeoutMs += 2_000
  if (rtt >= 700) timeoutMs += 4_000
  if (rtt >= 1_200) timeoutMs += 8_000

  if (contextChars >= 10_000) timeoutMs += 4_000
  if (contextChars >= 18_000) timeoutMs += 6_000

  if (maxTokens >= 700) timeoutMs += 3_000
  if (maxTokens >= 1_200) timeoutMs += 5_000

  return Math.max(16_000, Math.min(70_000, timeoutMs))
}

function computeLocalAttemptTimeoutMs(
  settings: Settings,
  isSmartRoute: boolean,
  contextChars = 0,
  maxTokens = 0,
): number {
  let timeoutMs = isSmartRoute ? LOCAL_PROVIDER_ATTEMPT_TIMEOUT_MS : 36_000
  const rtt = getNetworkRttMs()

  if (rtt >= 300) timeoutMs += 2_000
  if (rtt >= 700) timeoutMs += 4_000
  if (rtt >= 1_200) timeoutMs += 8_000

  if (contextChars >= 8_000) timeoutMs += 4_000
  if (contextChars >= 14_000) timeoutMs += 6_000

  if (maxTokens >= 700) timeoutMs += 3_000
  if (maxTokens >= 1_200) timeoutMs += 4_000

  return Math.max(18_000, Math.min(70_000, timeoutMs))
}

function computeAdaptiveChatTimeoutMs(settings: Settings, providerCount: number): number {
  let timeoutMs = CHAT_TIMEOUT_MS
  const rtt = getNetworkRttMs()
  const extraByProviders = Math.max(0, providerCount - 1) * 4_000
  timeoutMs += Math.min(12_000, extraByProviders)

  if (rtt >= 300) timeoutMs += 4_000
  if (rtt >= 700) timeoutMs += 8_000
  if (rtt >= 1_200) timeoutMs += 12_000

  return Math.max(CHAT_TIMEOUT_MS, Math.min(180_000, timeoutMs))
}

function computeAdaptiveMaxTokens(
  baseTokens: number,
  promptChars: number,
  contextChars: number,
  settings: Settings,
  baseUrl?: string,
): number {
  const providerLatency = getProviderLatencyMs(settings, baseUrl)
  const rtt = getNetworkRttMs()
  return computeChatRequestBudget({
    baseMaxTokens: baseTokens,
    promptChars,
    contextChars,
    providerLatencyMs: providerLatency,
    networkRttMs: rtt,
  }).maxTokens
}

function deniesWebAccess(content: string): boolean {
  const lower = content.toLowerCase()
  return (
    lower.includes('no tengo acceso a internet') ||
    lower.includes('no dispongo de acceso web') ||
    lower.includes('no tengo acceso web') ||
    lower.includes('i do not have access to the internet')
  )
}

async function waitRotationJitter(signal: AbortSignal): Promise<void> {
  const span = Math.max(0, ROTATION_JITTER_MAX_MS - ROTATION_JITTER_MIN_MS)
  const jitterMs = ROTATION_JITTER_MIN_MS + Math.floor(Math.random() * (span + 1))

  await new Promise<void>(resolve => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, jitterMs)

    const onAbort = () => {
      window.clearTimeout(timer)
      resolve()
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function countRecentProviderFailures(settings: Settings, cfg: CloudCfg): { auth: number; timeout: number; network: number } {
  const logs = settings.errorLogs ?? []
  const now = Date.now()
  const counters = { auth: 0, timeout: 0, network: 0 }

  for (const entry of logs) {
    if (!entry.at || now - entry.at > CLOUD_FAILURE_WINDOW_MS) continue
    if (!entry.route?.toLowerCase().includes('cloud')) continue
    if (!entry.provider || !isProviderMatch(entry.provider, cfg)) continue

    const msg = (entry.message ?? '').toLowerCase()
    if (msg.includes('401') || msg.includes('403') || msg.includes('invalid api key') || msg.includes('unauthorized')) {
      counters.auth += 1
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      counters.timeout += 1
    }
    if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('econnrefused')) {
      counters.network += 1
    }
  }

  return counters
}

function isFatalConnectivityDetail(detail: string): boolean {
  const lower = (detail ?? '').toLowerCase()
  return (
    lower.includes('sin api key') ||
    lower.includes('invalid api key') ||
    lower.includes('unauthorized') ||
    lower.includes('credenciales inválidas') ||
    lower.includes('credit limit exceeded') ||
    lower.includes('quota') ||
    lower.includes('model not found') ||
    lower.includes('no encuentra el modelo') ||
    lower.includes('no endpoints found') ||
    lower.includes('402')
  )
}

function shouldSkipProviderByConnectivity(settings: Settings, cfg: CloudCfg): boolean {
  const now = Date.now()
  const connectivity = settings.cloudConnectivity ?? []
  const match = connectivity.find(item => {
    const baseUrl = extractBaseUrlFromConnectivityLabel(item.label)
    return baseUrl && baseUrl.toLowerCase() === cfg.baseUrl.toLowerCase()
  })

  if (!match) return false
  if (!match.checkedAt || now - match.checkedAt > CLOUD_CONNECTIVITY_FRESH_MS) return false
  if (match.ok) return false
  return isFatalConnectivityDetail(match.detail)
}

function pruneCloudQueue(settings: Settings, queue: CloudCfg[]): CloudCfg[] {
  if (queue.length <= 1) return queue

  const viable = queue.filter(cfg => {
    if (sessionBlacklistedProviders.has(cfg.baseUrl.toLowerCase())) return false
    if (shouldSkipProviderByConnectivity(settings, cfg)) return false

    const fails = countRecentProviderFailures(settings, cfg)
    if (fails.auth >= 1) return false
    if (fails.timeout >= 2) return false
    return true
  })

  return viable.length > 0 ? viable : queue
}

function rankCloudProviders(settings: Settings, queue: CloudCfg[]): CloudCfg[] {
  if (queue.length <= 1) return queue

  const now = Date.now()
  const connectivity = settings.cloudConnectivity ?? []

  const scored = queue.map(cfg => {
    let score = 0

    const conn = connectivity.find(item => {
      const baseUrl = extractBaseUrlFromConnectivityLabel(item.label)
      return baseUrl && baseUrl.toLowerCase() === cfg.baseUrl.toLowerCase()
    })

    if (conn && now - conn.checkedAt <= CLOUD_HEALTH_WINDOW_MS) {
      score += conn.ok ? 30 : -70
      if (!conn.ok && /api key|credenciales|sin api key/i.test(conn.detail)) {
        score -= 50
      }
      if (!conn.ok && /no endpoints found|no encuentra el modelo|model not found|invalid api key|unauthorized|credit limit exceeded|402/i.test(conn.detail)) {
        score -= 220
      }
      score -= Math.min(20, Math.floor(conn.latencyMs / 200))
    }

    const fails = countRecentProviderFailures(settings, cfg)
    score -= fails.auth * 120
    score -= fails.timeout * 45
    score -= fails.network * 25
    if (cfg.model.toLowerCase().includes('openai/gpt-5.4-mini') || cfg.model.toLowerCase() === 'gpt-5.4-mini') {
      score += 35
    }

    // Session blacklist: providers confirmed fatal this session go to the very back
    if (sessionBlacklistedProviders.has(cfg.baseUrl.toLowerCase())) {
      score -= 500
    }

    return { cfg, score }
  })

  const filtered = scored.filter(item => item.score > -100)
  const ordered = (filtered.length > 0 ? filtered : scored)
    .sort((a, b) => b.score - a.score)
    .map(item => item.cfg)

  return ordered
}

function withRepairSuggestion(settings: Settings, message: string, provider: string, route: string): string {
  const analysis = analyzeErrorMessage(message, {
    provider,
    route,
    knowledgeBase: settings.errorKnowledgeBase,
  })
  const suggestion = analysis.suggestedFix?.trim()
  if (!suggestion) return message
  return `${message} Sugerencia: ${suggestion}`
}

async function repairWebGroundedResponse(
  client: OpenAICompatibleClient,
  cfg: CloudCfg,
  effectiveMessages: ChatMessageInput[],
  sysPrompt: string,
  temperature: number,
  maxTokens: number,
  draft?: string,
): Promise<string> {
  const repairedMessages: ChatMessageInput[] = [
    ...effectiveMessages,
    {
      role: 'system',
      content: 'Ya se te proporciono contexto web en los mensajes previos. Reescribe la respuesta usando ese contexto y sus fuentes. No afirmes que no tienes acceso a internet ni a la web; limita tu respuesta a la evidencia proporcionada y menciona al menos una fuente breve cuando aplique.',
    },
    ...(draft
      ? [{
          role: 'assistant' as const,
          content: draft,
        }]
      : []),
  ]

  return client.chat(cfg.model, repairedMessages, sysPrompt, temperature, maxTokens)
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

function resolveLocalModelName(settings: Settings, models: AIModel[]): string {
  const explicit = stripPrefix(settings.localModel || '').trim()
  if (explicit) return explicit

  const discoveredLocal = models.find(m => m.provider === 'ollama')?.name ?? ''
  return stripPrefix(discoveredLocal)
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
  const { startDiagnostic, log: diagLog, endDiagnostic } = useDiagnosticChat()
  const { activeId, addMessage, updateMessage, create, rename, upsertUserMemory } = useChatStore()
  const { settings, update: updateSettings } = useSettingsStore()
  // Solo activar diagnóstico si settings.debugMode o settings.diagnosticMode
  const enableDiag = (settings as any).debugMode || (settings as any).diagnosticMode

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const logError = useCallback((message: string, options?: { provider?: string; route?: string; autoRepairApplied?: boolean }) => {
    const currentSettings = useSettingsStore.getState().settings
    if (!currentSettings.autoErrorAssistEnabled) return
    const entry = createErrorLogEntry({
      source: 'chat',
      message,
      provider: options?.provider,
      route: options?.route,
      autoRepairApplied: options?.autoRepairApplied,
      knowledgeBase: currentSettings.errorKnowledgeBase,
    })
    updateSettings({
      ...appendErrorLog(currentSettings, entry),
      errorKnowledgeBase: updateErrorKnowledgeBase(currentSettings.errorKnowledgeBase, entry),
    })
  }, [updateSettings])

  const sendMessage = useCallback(async (content: string, attachments: MessageAttachment[] = []): Promise<void> => {
      let diagId: string | null = null
      if (enableDiag) {
        diagId = startDiagnostic('🛠️ Diagnóstico chat')
        diagLog(`Iniciando diagnóstico para mensaje: "${content}"`)
      }
    const text = content.trim()
    if ((!text && attachments.length === 0) || isLoading) return

    const model = settings.defaultModel || settings.legacyModel || settings.cloudModel || settings.localModel || models[0]?.name || 'auto-smart'
    const traceId = startChatTrace({
      providerMode: settings.provider,
      model,
      promptChars: text.length,
      attachmentCount: attachments.length,
    })
    let traceStatus: ChatTraceStatus = 'failed'
    let traceFinishAttrs: Record<string, unknown> = {}
    addChatTraceEvent(traceId, 'chat_send_start', { providerMode: settings.provider, stream: settings.streamResponses })

    setError(null)

    if (!model && settings.provider !== 'smart') {
      setError('Sin modelo seleccionado. Abre Ajustes ⚙️ y añade una API key.')
      traceFinishAttrs = { reason: 'missing-model' }
      finishChatTrace(traceId, 'failed', traceFinishAttrs)
      return
    }

    let convId = activeId
    if (!convId) convId = create(model)

    const userMessageId = addMessage(convId, { role: 'user', content: text, attachments, timestamp: Date.now() })

    for (const fact of extractImportantUserFacts(text)) {
      upsertUserMemory(convId, {
        key: fact.key,
        value: fact.value,
        sourceMessageId: userMessageId,
      })
    }

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
    if (enableDiag) diagLog('Preparando proveedores y rutas...')
    abortRef.current = new AbortController()
    let timeoutTriggered = false
    const providerSlots = 1 + (settings.additionalProviders ?? []).filter(item => item.enabled && item.baseUrl).length
    const adaptiveChatTimeoutMs = computeAdaptiveChatTimeoutMs(settings, providerSlots)
    const timeoutHandle = window.setTimeout(() => {
      timeoutTriggered = true
      abortRef.current?.abort(new DOMException('Chat timeout', 'AbortError'))
      addChatTraceEvent(traceId, 'global_timeout', { timeoutMs: adaptiveChatTimeoutMs })
      if (enableDiag) {
        diagLog(`Timeout global alcanzado (${Math.round(adaptiveChatTimeoutMs / 1000)}s): se abortó la operación activa de chat.`)
      }
    }, adaptiveChatTimeoutMs)

    try {
      const routePrompt = text || attachments.map(attachment => attachment.name).join(' ')
      let apiKey = ''
      let decision: ReturnType<typeof selectRoute>
      let sysPrompt = ''
      let cloudQueue: CloudCfg[] = []
      let avoidLocalFallback = false
      let avoidLegacyFallback = false

      try {
        apiKey = await getProviderApiKey()
        const currentSettings = useSettingsStore.getState().settings
        avoidLocalFallback = hasRecentLocalRuntimeConflict(currentSettings)
        avoidLegacyFallback = hasRecentLegacyConflict(currentSettings)

        if (avoidLegacyFallback && currentSettings.enableLegacyEngine) {
          updateSettings({ enableLegacyEngine: false })
        }

        const routingSettings: Settings = {
          ...currentSettings,
          enableLegacyEngine: currentSettings.enableLegacyEngine && !avoidLegacyFallback,
        }

        decision = selectRoute(routingSettings, routePrompt)
        addChatTraceEvent(traceId, 'route_decision', {
          target: decision.target,
          useWebSearch: decision.useWebSearch,
          maxTokens: decision.maxTokens,
          temperature: decision.temperature,
        })
        sysPrompt = buildSystemPrompt(settings.systemPrompt, settings.characterProfile)
        const builtCloudQueue = await buildCloudQueue(settings, models, apiKey, model, routePrompt, decision.maxTokens)
        const healthyQueue = await filterHealthyCloudProviders(builtCloudQueue)
        cloudQueue = pruneCloudQueue(currentSettings, rankCloudProviders(currentSettings, healthyQueue))
        const maxCloudAttempts = currentSettings.provider === 'smart'
          ? SMART_MAX_CLOUD_ATTEMPTS
          : MANUAL_CLOUD_MAX_ATTEMPTS
        cloudQueue = cloudQueue.slice(0, maxCloudAttempts)
      } catch (err) {
        if (enableDiag) diagLog(`Error en preparación: ${String(err)}`)
        const msg = summarizeProviderError(err)
        logError(msg, { route: settings.provider })
        setError(msg)
        updateMessage(convId, assistantId, `⚠️ ${msg}`, false)
        setIsLoading(false)
        return
      }

      const target = decision.target

    // ── Image generation branch ───────────────────────────────────────────────
    if (enableDiag) diagLog('Generando imagen...')
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
        logError(msg, { provider: settings.cloudBaseUrl, route: 'image' })
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
    const currentConversation = useChatStore.getState().conversations.find(c => c.id === convId)
    let effectiveMessages: ChatMessageInput[] = prependUserMemoryContext(
      apiMessages,
      currentConversation?.userMemory ?? [],
    )
    let webResultsCount = 0

    const shouldAttachCharacterImage = apiMessages.filter(message => message.role === 'user').length <= 1
    const characterContext = buildCharacterContextMessage(settings.characterProfile, shouldAttachCharacterImage)
    if (characterContext) {
      effectiveMessages = [characterContext, ...effectiveMessages]
    }
    if (decision.useWebSearch) {
      try {
        const web = await searchWeb(text, settings.webSearchMaxResults)
        webResultsCount = web.length
        addChatTraceEvent(traceId, web.length > 0 ? 'web_search_success' : 'web_search_empty', {
          queryChars: text.length,
          results: web.length,
        })
        effectiveMessages = prependWebContext(effectiveMessages, web)
      } catch (webErr) {
        addChatTraceEvent(traceId, 'web_search_error', {
          reason: summarizeProviderError(webErr),
        })
      }
    }

    const cloudHints = cloudQueue.flatMap(cfg => [cfg.baseUrl, cfg.label, cfg.model])
    const learnedPromptLimit = target === 'local'
      ? null
      : derivePromptLimitFromRecentErrors(
        useSettingsStore.getState().settings.errorLogs,
        cloudHints,
      )

    const adaptiveCloudContextBudget = learnedPromptLimit
      ? computeSafeContextCharsFromPromptLimit(learnedPromptLimit, text.length)
      : CLOUD_CONTEXT_BUDGET_CHARS

    const requestedCloudMaxTokens = Math.max(120, settings.cloudMaxTokens || 700, decision.maxTokens || 0)
    const requestedLocalMaxTokens = Math.max(120, settings.localMaxTokens || 400)
    const tokenDrivenCloudContextBudget = requestedCloudMaxTokens <= 500
      ? 4_200
      : requestedCloudMaxTokens <= 700
        ? 5_400
        : requestedCloudMaxTokens <= 900
          ? 6_600
          : requestedCloudMaxTokens <= 1_200
            ? 8_400
            : CLOUD_CONTEXT_BUDGET_CHARS

    const tokenDrivenLocalContextBudget = requestedLocalMaxTokens <= 320
      ? 2_900
      : requestedLocalMaxTokens <= 450
        ? 3_600
        : requestedLocalMaxTokens <= 700
          ? 4_600
          : 6_000

    const systemPromptChars = sysPrompt.length
    const systemPromptTokens = estimateTokensFromChars(systemPromptChars)
    const inferredPromptLimitTokens = target === 'local'
      ? null
      : (learnedPromptLimit ?? inferPromptLimitFromCloudQueue(cloudQueue, settings.preferFreeTier))

    const inputDrivenCloudContextBudget = inferredPromptLimitTokens
      ? Math.max(
        1_200,
        Math.floor(inferredPromptLimitTokens * 3.8) - systemPromptChars - Math.floor(text.length * 1.1) - 260,
      )
      : CLOUD_CONTEXT_BUDGET_CHARS

    const systemAwareLocalContextBudget = Math.max(1_400, Math.min(8_000, 9_000 - systemPromptChars))

    const contextBudget = target === 'local'
      ? Math.min(LOCAL_CONTEXT_BUDGET_CHARS, tokenDrivenLocalContextBudget, systemAwareLocalContextBudget)
      : Math.min(
        CLOUD_CONTEXT_BUDGET_CHARS,
        adaptiveCloudContextBudget,
        tokenDrivenCloudContextBudget,
        inputDrivenCloudContextBudget,
      )
    const beforeTrimMessages = effectiveMessages.length
    const beforeTrimChars = effectiveMessages.reduce((acc, item) => acc + estimateContextChars(item), 0)
    effectiveMessages = trimMessagesForBudget(effectiveMessages, contextBudget, CONTEXT_BUDGET_MAX_MESSAGES)
    const afterTrimChars = effectiveMessages.reduce((acc, item) => acc + estimateContextChars(item), 0)
    const effectiveContextChars = afterTrimChars
    const estimatedPromptTokens = estimateTokensFromChars(text.length)
    const estimatedContextTokens = estimateTokensFromChars(effectiveContextChars)
    addChatTraceEvent(traceId, 'context_budget', {
      target,
      beforeMessages: beforeTrimMessages,
      beforeChars: beforeTrimChars,
      afterMessages: effectiveMessages.length,
      afterChars: afterTrimChars,
      promptChars: text.length,
      promptTokens: estimatedPromptTokens,
      systemPromptChars,
      systemPromptTokens,
      contextTokens: estimatedContextTokens,
      budgetChars: contextBudget,
      requestedCloudMaxTokens,
      requestedLocalMaxTokens,
      tokenDrivenCloudBudgetChars: tokenDrivenCloudContextBudget,
      tokenDrivenLocalBudgetChars: tokenDrivenLocalContextBudget,
      inputDrivenCloudBudgetChars: inputDrivenCloudContextBudget,
      learnedPromptLimitTokens: learnedPromptLimit,
      inferredPromptLimitTokens,
    })
    if (enableDiag && (beforeTrimMessages !== effectiveMessages.length || beforeTrimChars !== afterTrimChars)) {
      diagLog(`Contexto recortado: ${beforeTrimMessages} mensajes (${beforeTrimChars} chars aprox) -> ${effectiveMessages.length} mensajes (${afterTrimChars} chars aprox).`)
    }

    // ── Legacy engine mode ────────────────────────────────────────────────────
    if (settings.provider === 'legacy-engine' || target === 'legacy') {
      const legacyModel = stripPrefix(settings.legacyModel || model || 'legacy-default')
      const legacyStartedAt = Date.now()
      addChatTraceEvent(traceId, 'legacy_attempt_start', { model: legacyModel })
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
          updateMessage(convId!, assistantId, acc, false, undefined, `kawaii • ${legacyModel}`)
        } else {
          const r = await legacyClient.chat(
            legacyModel, effectiveMessages, sysPrompt, decision.temperature, settings.cloudMaxTokens,
          )
          updateMessage(convId!, assistantId, r, false, undefined, `kawaii • ${legacyModel}`)
        }
        addChatTraceEvent(traceId, 'legacy_attempt_success', { elapsedMs: Date.now() - legacyStartedAt, model: legacyModel })
        traceStatus = 'success'
        traceFinishAttrs = { finalRoute: 'legacy', model: legacyModel }
      } catch (err) {
        addChatTraceEvent(traceId, 'legacy_attempt_error', {
          elapsedMs: Date.now() - legacyStartedAt,
          code: extractStatusCode(String(err instanceof Error ? err.message : err)) ?? null,
          reason: summarizeProviderError(err),
        })
        if ((err as Error).name === 'AbortError') {
          if (timeoutTriggered) {
            const timeoutMessage = `⏰ Timeout: la operación de chat superó el límite de ${Math.round(adaptiveChatTimeoutMs / 1000)}s.`
            const detailed = withRepairSuggestion(useSettingsStore.getState().settings, timeoutMessage, 'chat-runtime', 'legacy')
            setError(detailed)
            updateMessage(convId, assistantId, `⚠️ ${detailed}`, false)
            logError(detailed, { provider: 'chat-runtime', route: 'legacy' })
            setIsLoading(false)
            return
          }
          const partial = useChatStore.getState()
            .conversations.find(c => c.id === convId)
            ?.messages.find(m => m.id === assistantId)?.content ?? ''
          updateMessage(convId, assistantId, partial, false)
          setIsLoading(false)
          return
        }

        const msg = err instanceof Error ? err.message : String(err)
        logError(msg, { provider: settings.legacyEngineBaseUrl, route: 'legacy' })

        const fallbackLocalModel = resolveLocalModelName(settings, models)
        if (settings.provider === 'smart' && settings.autoFailover && fallbackLocalModel && !avoidLocalFallback) {
          const localModel = fallbackLocalModel
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
              logError(msg, { provider: settings.localBaseUrl, route: 'legacy->local', autoRepairApplied: true })
            } else {
              const r = await localClient.chat(
                localModel, effectiveMessages, sysPrompt, decision.temperature, settings.localMaxTokens,
              )
              updateMessage(convId!, assistantId, r, false, undefined, `local (fallback) • ${localModel}`)
              logError(msg, { provider: settings.localBaseUrl, route: 'legacy->local', autoRepairApplied: true })
            }
            traceStatus = 'success'
            traceFinishAttrs = { finalRoute: 'legacy->local', model: localModel }
          } catch (fbErr) {
            const fbMsg = summarizeProviderError(fbErr)
            logError(fbMsg, { provider: settings.localBaseUrl, route: 'legacy->local' })
            setError(fbMsg)
            updateMessage(convId!, assistantId, `⚠️ ${fbMsg}`, false)
          } finally {
            setIsLoading(false)
          }
          return
        }

        setError(msg)
        logError(msg, { provider: settings.legacyEngineBaseUrl, route: 'legacy' })
        updateMessage(convId, assistantId, `⚠️ ${msg}`, false)
      } finally {
        setIsLoading(false)
      }
      return
    }

    // ── Local mode (Ollama) with Smart failover ───────────────────────────────
    if (target === 'local') {
      const localModel = resolveLocalModelName(settings, models) || stripPrefix(settings.localModel || model)
      const localClient = new OllamaClient(settings.localBaseUrl)
      const localStartedAt = Date.now()
      const localAttemptTimeoutMs = computeLocalAttemptTimeoutMs(
        useSettingsStore.getState().settings,
        settings.provider === 'smart',
        effectiveContextChars,
        settings.localMaxTokens,
      )
      addChatTraceEvent(traceId, 'local_attempt_start', {
        model: localModel,
        timeoutMs: localAttemptTimeoutMs,
        promptTokens: estimateTokensFromChars(text.length),
        contextTokens: estimateTokensFromChars(effectiveContextChars),
      })
      const localAttempt = createProviderAttemptAbort(abortRef.current!.signal, localAttemptTimeoutMs)
      let localFailed = false
      try {
        if (settings.streamResponses) {
          let acc = ''
          const streamUi = createStreamUpdateController((partial) => {
            updateMessage(convId!, assistantId, partial, true)
          })
          for await (const chunk of localClient.streamChat(
            localModel, effectiveMessages, sysPrompt,
            decision.temperature, settings.localMaxTokens, localAttempt.signal,
          )) {
            acc += chunk
            streamUi.push(acc, chunk)
          }
          streamUi.flush(acc)
          updateMessage(convId!, assistantId, acc, false, undefined, `local • ${localModel}`)
        } else {
          const r = await withAbortableTimeout(
            localClient.chat(
              localModel, effectiveMessages, sysPrompt, decision.temperature, settings.localMaxTokens,
            ),
            localAttempt.signal,
            localAttemptTimeoutMs,
          )
          updateMessage(convId!, assistantId, r, false, undefined, `local • ${localModel}`)
        }
        addChatTraceEvent(traceId, 'local_attempt_success', { elapsedMs: Date.now() - localStartedAt, model: localModel })
        traceStatus = 'success'
        traceFinishAttrs = { finalRoute: 'local', model: localModel }
        setIsLoading(false)
        return
      } catch (err) {
        addChatTraceEvent(traceId, 'local_attempt_error', {
          elapsedMs: Date.now() - localStartedAt,
          code: extractStatusCode(String(err instanceof Error ? err.message : err)) ?? null,
          reason: summarizeProviderError(err),
        })
        const localProviderTimedOut = localAttempt.wasTimedOut()
        if ((err as Error).name === 'AbortError') {
          if (timeoutTriggered) {
            const timeoutMessage = `⏰ Timeout: la operación de chat superó el límite de ${Math.round(adaptiveChatTimeoutMs / 1000)}s.`
            const detailed = withRepairSuggestion(useSettingsStore.getState().settings, timeoutMessage, 'chat-runtime', 'local')
            setError(detailed)
            updateMessage(convId, assistantId, `⚠️ ${detailed}`, false)
            logError(detailed, { provider: 'chat-runtime', route: 'local' })
            setIsLoading(false)
            return
          }

          if (localProviderTimedOut && settings.provider === 'smart') {
            const localTimeoutMsg = `Timeout local tras ${Math.round(localAttemptTimeoutMs / 1000)}s sin respuesta útil.`
            updateMessage(convId, assistantId, `⚠️ ${localTimeoutMsg} → intentando fallback cloud...`, true)
            logError(localTimeoutMsg, { provider: settings.localBaseUrl, route: 'local', autoRepairApplied: true })
            localFailed = true
          } else {
            const partial = useChatStore.getState()
              .conversations.find(c => c.id === convId)
              ?.messages.find(m => m.id === assistantId)?.content ?? ''
            updateMessage(convId, assistantId, partial, false)
            setIsLoading(false)
            return
          }
        }
        if ((err as Error).name !== 'AbortError') {
          const msg = err instanceof Error ? err.message : String(err)
          setError(msg)
          updateMessage(convId, assistantId, `⚠️ ${msg} → intentando fallback cloud...`, true)
          localFailed = true
          logError(msg, { provider: settings.localBaseUrl, route: 'local', autoRepairApplied: true })
        }
      } finally {
        localAttempt.clear()
      }
      // Smart failover: try cloud, then legacy if enabled
      if (localFailed) {
        const fallbackCloudHints = cloudQueue.flatMap(cfg => [cfg.baseUrl, cfg.label, cfg.model])
        const fallbackLearnedPromptLimit = derivePromptLimitFromRecentErrors(
          useSettingsStore.getState().settings.errorLogs,
          fallbackCloudHints,
        )
        const fallbackAdaptiveCloudBudget = fallbackLearnedPromptLimit
          ? computeSafeContextCharsFromPromptLimit(fallbackLearnedPromptLimit, text.length)
          : CLOUD_CONTEXT_BUDGET_CHARS
        const fallbackRequestedCloudMaxTokens = Math.max(120, settings.cloudMaxTokens || 700)
        const fallbackTokenDrivenCloudBudget = fallbackRequestedCloudMaxTokens <= 500
          ? 4_200
          : fallbackRequestedCloudMaxTokens <= 700
            ? 5_400
            : fallbackRequestedCloudMaxTokens <= 900
              ? 6_600
              : fallbackRequestedCloudMaxTokens <= 1_200
                ? 8_400
                : CLOUD_CONTEXT_BUDGET_CHARS
        const fallbackInferredPromptLimit = fallbackLearnedPromptLimit
          ?? inferPromptLimitFromCloudQueue(cloudQueue, settings.preferFreeTier)
        const fallbackInputDrivenBudget = Math.max(
          1_200,
          Math.floor(fallbackInferredPromptLimit * 3.8) - systemPromptChars - Math.floor(text.length * 1.1) - 260,
        )
        const fallbackCloudContextBudget = Math.min(
          CLOUD_CONTEXT_BUDGET_CHARS,
          fallbackAdaptiveCloudBudget,
          fallbackTokenDrivenCloudBudget,
          fallbackInputDrivenBudget,
        )
        const beforeFallbackChars = effectiveMessages.reduce((acc, item) => acc + estimateContextChars(item), 0)
        effectiveMessages = trimMessagesForBudget(effectiveMessages, fallbackCloudContextBudget, CONTEXT_BUDGET_MAX_MESSAGES)
        const afterFallbackChars = effectiveMessages.reduce((acc, item) => acc + estimateContextChars(item), 0)
        addChatTraceEvent(traceId, 'context_budget_retrim_cloud_fallback', {
          beforeChars: beforeFallbackChars,
          afterChars: afterFallbackChars,
          budgetChars: fallbackCloudContextBudget,
          inferredPromptLimitTokens: fallbackInferredPromptLimit,
          learnedPromptLimitTokens: fallbackLearnedPromptLimit,
          requestedCloudMaxTokens: fallbackRequestedCloudMaxTokens,
        })

        // Try cloud providers if available
        if (cloudQueue.length > 0) {
          for (let idx = 0; idx < cloudQueue.length; idx++) {
            const cfg = cloudQueue[idx]
            const cloudClient = new OpenAICompatibleClient(cfg.baseUrl, cfg.apiKey)
            let providerMaxTokens = computeAdaptiveMaxTokens(
              cfg.maxTokens,
              text.length,
              effectiveContextChars,
              useSettingsStore.getState().settings,
              cfg.baseUrl,
            )
            const learnedCap = deriveTokenCapFromRecentErrors(
              useSettingsStore.getState().settings.errorLogs,
              [cfg.baseUrl, cfg.label, cfg.model],
            )
            if (typeof learnedCap === 'number' && learnedCap > 0) {
              providerMaxTokens = Math.max(120, Math.min(providerMaxTokens, learnedCap))
            }
            const providerTimeoutMs = computeAdaptiveProviderTimeoutMs(
              useSettingsStore.getState().settings,
              cfg.baseUrl,
              effectiveContextChars,
              providerMaxTokens,
            )
            const providerAttempt = createProviderAttemptAbort(abortRef.current!.signal, providerTimeoutMs)
            addChatTraceEvent(traceId, 'cloud_attempt_start', {
              provider: cfg.label,
              idx: idx + 1,
              total: cloudQueue.length,
              maxTokens: providerMaxTokens,
              promptTokens: estimateTokensFromChars(text.length),
              contextTokens: estimateTokensFromChars(effectiveContextChars),
              timeoutMs: providerTimeoutMs,
              phase: 'local->cloud',
            })
            const cloudAttemptStartedAt = Date.now()
            try {
              if (settings.streamResponses) {
                let acc = ''
                const streamUi = createStreamUpdateController((partial) => {
                  updateMessage(convId!, assistantId, partial, true)
                })
                for await (const chunk of cloudClient.streamChat(
                  cfg.model, effectiveMessages, sysPrompt,
                  decision.temperature, providerMaxTokens, providerAttempt.signal,
                )) {
                  acc += chunk
                  streamUi.push(acc, chunk)
                }
                streamUi.flush(acc)
                updateMessage(convId!, assistantId, acc, false, undefined, cfg.label)
              } else {
                const r = await withAbortableTimeout(
                  cloudClient.chat(
                    cfg.model, effectiveMessages, sysPrompt, decision.temperature, providerMaxTokens,
                  ),
                  providerAttempt.signal,
                  providerTimeoutMs,
                )
                updateMessage(convId!, assistantId, r, false, undefined, cfg.label)
              }
              updateSettings({ cloudDiagnostics: null })
              addChatTraceEvent(traceId, 'cloud_attempt_success', {
                provider: cfg.label,
                elapsedMs: Date.now() - cloudAttemptStartedAt,
                phase: 'local->cloud',
              })
              traceStatus = 'success'
              traceFinishAttrs = { finalRoute: 'local->cloud', provider: cfg.label }
              setIsLoading(false)
              return
            } catch (cloudErr) {
              const errMsg = summarizeProviderError(cloudErr)
              addChatTraceEvent(traceId, 'cloud_attempt_error', {
                provider: cfg.label,
                elapsedMs: Date.now() - cloudAttemptStartedAt,
                code: extractStatusCode(errMsg) ?? null,
                reason: errMsg,
                phase: 'local->cloud',
              })
              logError(errMsg, { provider: cfg.label, route: 'local->cloud', autoRepairApplied: true })
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
              if (isRetryableCloudError(cloudErr) && idx < cloudQueue.length - 1) {
                const next = cloudQueue[idx + 1]
                updateMessage(
                  convId!, assistantId,
                  `⚡ ${cfg.label}: ${errMsg} → rotando a ${next.label}...`,
                  true,
                )
                await waitRotationJitter(abortRef.current!.signal)
                continue
              }
            } finally {
              providerAttempt.clear()
            }
          }
        }
        // If cloud fails or not available, do NOT try legacy in Smart mode
        setIsLoading(false)
        return
      }
    }

    // ── Cloud mode with automatic provider rotation ───────────────────────────
    if (cloudQueue.length === 0) {
      if (settings.provider === 'smart') {
        const localModel = resolveLocalModelName(settings, models)
        if (localModel && !avoidLocalFallback) {
          const localClient = new OllamaClient(settings.localBaseUrl)
          const localAttemptTimeoutMs = computeLocalAttemptTimeoutMs(
            useSettingsStore.getState().settings,
            true,
            effectiveContextChars,
            settings.localMaxTokens,
          )
          const localAttempt = createProviderAttemptAbort(abortRef.current!.signal, localAttemptTimeoutMs)
          try {
            updateMessage(
              convId,
              assistantId,
              '⚡ Cloud no disponible en este intento. Aplicando fallback local para mantener el chat fluido...',
              true,
            )
            if (settings.streamResponses) {
              let acc = ''
              const streamUi = createStreamUpdateController((partial) => {
                updateMessage(convId!, assistantId, partial, true)
              })
              for await (const chunk of localClient.streamChat(
                localModel, effectiveMessages, sysPrompt,
                decision.temperature, settings.localMaxTokens, localAttempt.signal,
              )) {
                acc += chunk
                streamUi.push(acc, chunk)
              }
              streamUi.flush(acc)
              updateMessage(convId!, assistantId, acc, false, undefined, `local (smart fallback) • ${localModel}`)
            } else {
              const r = await withAbortableTimeout(
                localClient.chat(
                  localModel, effectiveMessages, sysPrompt, decision.temperature, settings.localMaxTokens,
                ),
                localAttempt.signal,
                localAttemptTimeoutMs,
              )
              updateMessage(convId!, assistantId, r, false, undefined, `local (smart fallback) • ${localModel}`)
            }
            logError('Cloud queue vacia en Smart mode; fallback local aplicado.', {
              provider: settings.localBaseUrl,
              route: 'cloud->local',
              autoRepairApplied: true,
            })
            setIsLoading(false)
            return
          } catch {
            // If local fallback also fails, continue to standard cloud error handling below.
          } finally {
            localAttempt.clear()
          }
        }
      }

      const notice = '⚠️ Sin proveedor cloud disponible. Revisa API keys, endpoint y modelo en Ajustes ⚙️.'
      const detailed = withRepairSuggestion(useSettingsStore.getState().settings, notice, 'cloud-queue', 'cloud')
      logError(detailed, { route: 'cloud-queue' })
      updateSettings({
        cloudDiagnostics: {
          lastProvider: 'cloud-queue',
          lastError: detailed,
          lastAt: Date.now(),
          attempt: 0,
          total: 0,
        },
      })
      setError(detailed)
      updateMessage(convId, assistantId, detailed, false)
      setIsLoading(false)
      return
    }

    for (let idx = 0; idx < cloudQueue.length; idx++) {
      const cfg = cloudQueue[idx]
      const cloudClient = new OpenAICompatibleClient(cfg.baseUrl, cfg.apiKey)
      let providerMaxTokens = computeAdaptiveMaxTokens(
        cfg.maxTokens,
        text.length,
        effectiveContextChars,
        useSettingsStore.getState().settings,
        cfg.baseUrl,
      )
      const learnedCap = deriveTokenCapFromRecentErrors(
        useSettingsStore.getState().settings.errorLogs,
        [cfg.baseUrl, cfg.label, cfg.model],
      )
      if (typeof learnedCap === 'number' && learnedCap > 0) {
        providerMaxTokens = Math.max(120, Math.min(providerMaxTokens, learnedCap))
      }
      const providerTimeoutMs = computeAdaptiveProviderTimeoutMs(
        useSettingsStore.getState().settings,
        cfg.baseUrl,
        effectiveContextChars,
        providerMaxTokens,
      )
      const providerAttempt = createProviderAttemptAbort(abortRef.current!.signal, providerTimeoutMs)
      addChatTraceEvent(traceId, 'cloud_attempt_start', {
        provider: cfg.label,
        idx: idx + 1,
        total: cloudQueue.length,
        maxTokens: providerMaxTokens,
        promptTokens: estimateTokensFromChars(text.length),
        contextTokens: estimateTokensFromChars(effectiveContextChars),
        timeoutMs: providerTimeoutMs,
        phase: 'cloud',
      })
      const cloudAttemptStartedAt = Date.now()

      try {
        if (settings.streamResponses) {
          let acc = ''
          const streamUi = createStreamUpdateController((partial) => {
            updateMessage(convId!, assistantId, partial, true)
          })
          for await (const chunk of cloudClient.streamChat(
            cfg.model, effectiveMessages, sysPrompt,
            decision.temperature, providerMaxTokens, providerAttempt.signal,
          )) {
            acc += chunk
            streamUi.push(acc, chunk)
          }
          streamUi.flush(acc)
          if (decision.useWebSearch && webResultsCount > 0 && deniesWebAccess(acc)) {
            addChatTraceEvent(traceId, 'web_response_repair_start', { provider: cfg.label, results: webResultsCount })
            const repaired = await repairWebGroundedResponse(
              cloudClient,
              cfg,
              effectiveMessages,
              sysPrompt,
              decision.temperature,
              providerMaxTokens,
              acc,
            )
            acc = repaired
            addChatTraceEvent(traceId, 'web_response_repair_success', { provider: cfg.label })
          }
          if (isLikelyPolicyRefusal(acc) && isLikelyBenignPrompt(routePrompt) && idx < cloudQueue.length - 1) {
            throw new Error(`${SOFT_REFUSAL_ERR}: respuesta bloqueada en prompt benigno`)
          }
          updateMessage(convId!, assistantId, acc, false, undefined, cfg.label)
        } else {
          const r = await withAbortableTimeout(
            cloudClient.chat(
              cfg.model, effectiveMessages, sysPrompt, decision.temperature, providerMaxTokens,
            ),
            providerAttempt.signal,
            providerTimeoutMs,
          )
          let responseText = r
          if (decision.useWebSearch && webResultsCount > 0 && deniesWebAccess(responseText)) {
            addChatTraceEvent(traceId, 'web_response_repair_start', { provider: cfg.label, results: webResultsCount })
            responseText = await repairWebGroundedResponse(
              cloudClient,
              cfg,
              effectiveMessages,
              sysPrompt,
              decision.temperature,
              providerMaxTokens,
              responseText,
            )
            addChatTraceEvent(traceId, 'web_response_repair_success', { provider: cfg.label })
          }
          if (isLikelyPolicyRefusal(responseText) && isLikelyBenignPrompt(routePrompt) && idx < cloudQueue.length - 1) {
            throw new Error(`${SOFT_REFUSAL_ERR}: respuesta bloqueada en prompt benigno`)
          }
          updateMessage(convId!, assistantId, responseText, false, undefined, cfg.label)
        }
        updateSettings({ cloudDiagnostics: null })
        addChatTraceEvent(traceId, 'cloud_attempt_success', {
          provider: cfg.label,
          elapsedMs: Date.now() - cloudAttemptStartedAt,
          phase: 'cloud',
        })
        traceStatus = 'success'
        traceFinishAttrs = { finalRoute: 'cloud', provider: cfg.label }
        setIsLoading(false)
        return // ✓ success

      } catch (err) {
        const providerTimedOut = providerAttempt.wasTimedOut()
        // Abort → preserve partial content
        if ((err as Error).name === 'AbortError') {
          if (!timeoutTriggered && !providerTimedOut) {
            const partial = useChatStore.getState()
              .conversations.find(c => c.id === convId)
              ?.messages.find(m => m.id === assistantId)?.content ?? ''
            updateMessage(convId, assistantId, partial, false)
            setIsLoading(false)
            return
          }

          const timeoutMessage = timeoutTriggered
            ? `⏰ Timeout: la operación de chat superó el límite de ${Math.round(adaptiveChatTimeoutMs / 1000)}s.`
            : `Timeout del proveedor tras ${Math.round(providerTimeoutMs / 1000)}s sin respuesta útil.`
          const errMsg = summarizeProviderError(timeoutMessage)
          logError(errMsg, { provider: cfg.label, route: 'cloud' })
          updateSettings({
            cloudDiagnostics: {
              lastProvider: cfg.label,
              lastError: errMsg,
              lastAt: Date.now(),
              attempt: idx + 1,
              total: cloudQueue.length,
              code: 408,
            },
          })

          if (idx < cloudQueue.length - 1) {
            const next = cloudQueue[idx + 1]
            updateMessage(
              convId!, assistantId,
              `⚡ ${cfg.label}: ${errMsg} → rotando a ${next.label}...`,
              true,
            )
            await waitRotationJitter(abortRef.current!.signal)
            continue
          }

          const detailedTimeout = withRepairSuggestion(useSettingsStore.getState().settings, errMsg, cfg.label, 'cloud')
          const fallbackLocalModel = resolveLocalModelName(settings, models)
          if (settings.autoFailover && fallbackLocalModel && !avoidLocalFallback) {
            const localModel = fallbackLocalModel
            const localClient = new OllamaClient(settings.localBaseUrl)
            updateMessage(convId!, assistantId, `⚠️ Nube agotada por timeout (${errMsg}) → usando modelo local...`, true)
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
                updateMessage(convId!, assistantId, acc, false, undefined, `local (fallback-timeout) • ${localModel}`)
              } else {
                const r = await localClient.chat(
                  localModel, effectiveMessages, sysPrompt, decision.temperature, settings.localMaxTokens,
                )
                updateMessage(convId!, assistantId, r, false, undefined, `local (fallback-timeout) • ${localModel}`)
              }
              logError(errMsg, { provider: settings.localBaseUrl, route: 'cloud->local', autoRepairApplied: true })
              traceStatus = 'success'
              traceFinishAttrs = { finalRoute: 'cloud->local-timeout', model: localModel }
              setIsLoading(false)
              return
            } catch (fbErr) {
              const fbMsg = summarizeProviderError(fbErr)
              logError(fbMsg, { provider: settings.localBaseUrl, route: 'cloud->local' })
              setError(fbMsg)
              updateMessage(convId!, assistantId, `⚠️ ${fbMsg}`, false)
              setIsLoading(false)
              return
            }
          }

          setError(detailedTimeout)
          updateMessage(convId, assistantId, `⚠️ ${detailedTimeout}`, false)
          setIsLoading(false)
          return
        }

        let errMsg = summarizeProviderError(err)
        addChatTraceEvent(traceId, 'cloud_attempt_error', {
          provider: cfg.label,
          elapsedMs: Date.now() - cloudAttemptStartedAt,
          code: extractStatusCode(errMsg) ?? null,
          reason: errMsg,
          phase: 'cloud',
        })

        if (isQuotaError(err)) {
          const retryMaxTokens = computeQuotaRetryMaxTokens(providerMaxTokens, errMsg)
          if (retryMaxTokens && retryMaxTokens < providerMaxTokens) {
            updateMessage(
              convId!, assistantId,
              `⚡ ${cfg.label}: limite de creditos/tokens detectado → reintentando con max_tokens=${retryMaxTokens}...`,
              true,
            )

            const retryAttempt = createProviderAttemptAbort(abortRef.current!.signal, providerTimeoutMs)
            try {
              if (settings.streamResponses) {
                let acc = ''
                const streamUi = createStreamUpdateController((partial) => {
                  updateMessage(convId!, assistantId, partial, true)
                })
                for await (const chunk of cloudClient.streamChat(
                  cfg.model, effectiveMessages, sysPrompt,
                  decision.temperature, retryMaxTokens, retryAttempt.signal,
                )) {
                  acc += chunk
                  streamUi.push(acc, chunk)
                }
                streamUi.flush(acc)
                updateMessage(convId!, assistantId, acc, false, undefined, `${cfg.label} • auto-token-cap`)
              } else {
                const retried = await withAbortableTimeout(
                  cloudClient.chat(
                    cfg.model, effectiveMessages, sysPrompt, decision.temperature, retryMaxTokens,
                  ),
                  retryAttempt.signal,
                  providerTimeoutMs,
                )
                updateMessage(convId!, assistantId, retried, false, undefined, `${cfg.label} • auto-token-cap`)
              }
              updateSettings({ cloudDiagnostics: null })
              addChatTraceEvent(traceId, 'quota_retry_success', {
                provider: cfg.label,
                retryMaxTokens,
              })
              traceStatus = 'success'
              traceFinishAttrs = { finalRoute: 'cloud', provider: cfg.label, autoTokenCap: retryMaxTokens }
              setIsLoading(false)
              return
            } catch (retryErr) {
              errMsg = summarizeProviderError(retryErr)
              addChatTraceEvent(traceId, 'quota_retry_error', {
                provider: cfg.label,
                retryMaxTokens,
                code: extractStatusCode(errMsg) ?? null,
                reason: errMsg,
              })
              logError(
                `Reintento auto-token-cap fallo (${retryMaxTokens}): ${errMsg}`,
                { provider: cfg.label, route: 'cloud' },
              )
            } finally {
              retryAttempt.clear()
            }
          }
        }

        logError(errMsg, { provider: cfg.label, route: 'cloud' })
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

        // Black-list providers with fatal non-recoverable errors for the rest of the session
        if (isFatalProviderError(err)) {
          sessionBlacklistedProviders.add(cfg.baseUrl.toLowerCase())
        }

        // Retryable cloud error → rotate to next provider in queue
        if (isRetryableCloudError(err) && idx < cloudQueue.length - 1) {
          const next = cloudQueue[idx + 1]
          updateMessage(
            convId!, assistantId,
            `⚡ ${cfg.label}: ${errMsg} → rotando a ${next.label}...`,
            true,
          )
          await waitRotationJitter(abortRef.current!.signal)
          continue
        }

        // All cloud providers exhausted or non-quota error → kawaii/local auto-failover
        // In Smart mode, never fall back to legacy engine if cloud fails

        const fallbackLocalModel = resolveLocalModelName(settings, models)
        if (settings.autoFailover && fallbackLocalModel && !avoidLocalFallback) {
          const localModel = fallbackLocalModel
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
              logError(errMsg, { provider: settings.localBaseUrl, route: 'cloud->local', autoRepairApplied: true })
            } else {
              const r = await localClient.chat(
                localModel, effectiveMessages, sysPrompt, decision.temperature, settings.localMaxTokens,
              )
              updateMessage(convId!, assistantId, r, false, undefined, `local (fallback) • ${localModel}`)
              logError(errMsg, { provider: settings.localBaseUrl, route: 'cloud->local', autoRepairApplied: true })
            }
            traceStatus = 'success'
            traceFinishAttrs = { finalRoute: 'cloud->local', model: localModel }
          } catch (fbErr) {
            const fbMsg = summarizeProviderError(fbErr)
            logError(fbMsg, { provider: settings.localBaseUrl, route: 'cloud->local' })
            setError(fbMsg)
            updateMessage(convId!, assistantId, `⚠️ ${fbMsg}`, false)
          }
          setIsLoading(false)
          return
        }

        const msg = summarizeProviderError(err)
        if (avoidLocalFallback || avoidLegacyFallback) {
          const details = [
            avoidLegacyFallback ? 'motor Kawaii desactivado temporalmente por conflictos recientes' : '',
            avoidLocalFallback ? 'runtime local con errores de memoria recientes' : '',
          ].filter(Boolean).join(' · ')
          const finalMessage = details ? `${msg}. ${details}` : msg
          const detailed = withRepairSuggestion(useSettingsStore.getState().settings, finalMessage, cfg.label, 'cloud')
          logError(detailed, { provider: cfg.label, route: 'cloud' })
          setError(detailed)
          updateMessage(convId, assistantId, `⚠️ ${detailed}`, false)
          setIsLoading(false)
          return
        }
        const detailed = withRepairSuggestion(useSettingsStore.getState().settings, msg, cfg.label, 'cloud')
        logError(detailed, { provider: cfg.label, route: 'cloud' })
        setError(detailed)
        updateMessage(convId, assistantId, `⚠️ ${detailed}`, false)
        setIsLoading(false)
        return
      } finally {
        providerAttempt.clear()
      }
    }

      setIsLoading(false)
    } finally {
      window.clearTimeout(timeoutHandle)
      if (timeoutTriggered && traceStatus !== 'success') {
        traceStatus = 'aborted'
      }
      finishChatTrace(traceId, traceStatus, traceFinishAttrs)
      if (enableDiag) {
        diagLog('Chat finalizado.')
        endDiagnostic()
      }
    }
  }, [isLoading, activeId, settings, models, addMessage, updateMessage, create, rename, upsertUserMemory, updateSettings, logError])

  const stopStreaming = useCallback((): void => {
    abortRef.current?.abort()
  }, [])

  return { sendMessage, stopStreaming, isLoading, error, clearError: () => setError(null) }

}
