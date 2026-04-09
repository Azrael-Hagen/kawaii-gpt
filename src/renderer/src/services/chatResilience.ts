import type { ErrorLogEntry } from '@/types'

const TOKEN_WINDOW_MS = 6 * 60 * 60_000
const MIN_SAFE_COMPLETION_TOKENS = 120
const RETRY_SAFETY_MARGIN = 24
const CONTEXT_TOKEN_SAFETY_MARGIN = 140
const MIN_CONTEXT_TOKENS = 220
const MAX_CONTEXT_CHARS = 28_000
const CHARS_PER_TOKEN = 3.8

export function extractAffordableTokensFromError(message: string): number | null {
  const text = (message ?? '').toLowerCase()
  const patterns = [
    /can only afford\s+(\d+)(?:\s+tokens?)?/i,
    /solo puede[^\d]*(\d+)\s+tokens?/i,
    /max(?:imum)?\s+tokens?[^\d]*(\d+)/i,
    /requested up to\s+\d+\s+tokens?,\s+but can only afford\s+(\d+)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const parsed = Number(match[1])
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }

  return null
}

export function computeQuotaRetryMaxTokens(requestedMaxTokens: number, errorMessage: string): number | null {
  const affordable = extractAffordableTokensFromError(errorMessage)
  if (!affordable) return null

  const reduced = Math.min(requestedMaxTokens, affordable - RETRY_SAFETY_MARGIN)
  if (!Number.isFinite(reduced)) return null
  if (reduced >= requestedMaxTokens) return null
  if (reduced < MIN_SAFE_COMPLETION_TOKENS) return MIN_SAFE_COMPLETION_TOKENS
  return reduced
}

export function extractPromptLimitFromError(message: string): number | null {
  const text = message ?? ''
  const lower = text.toLowerCase()

  const explicitExceeded = lower.match(/prompt\s+tokens\s+limit\s+exceeded\s*:\s*(\d+)\s*>\s*(\d+)/i)
  if (explicitExceeded?.[2]) {
    const parsed = Number(explicitExceeded[2])
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }

  const genericComparator = lower.match(/(\d+)\s*>\s*(\d+)\s*(?:tokens?)?/i)
  if (genericComparator?.[2]) {
    const parsed = Number(genericComparator[2])
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }

  const maxContext = lower.match(/maximum\s+context\s+length\s+is\s+(\d+)\s+tokens?/i)
  if (maxContext?.[1]) {
    const parsed = Number(maxContext[1])
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }

  return null
}

export function computeSafeContextCharsFromPromptLimit(
  promptLimitTokens: number,
  promptChars: number,
): number {
  const promptTokens = Math.max(0, Math.ceil(promptChars / CHARS_PER_TOKEN))
  const safeContextTokens = Math.max(
    MIN_CONTEXT_TOKENS,
    promptLimitTokens - promptTokens - CONTEXT_TOKEN_SAFETY_MARGIN,
  )
  return Math.max(1_200, Math.min(MAX_CONTEXT_CHARS, Math.floor(safeContextTokens * CHARS_PER_TOKEN)))
}

function matchesProviderHint(providerText: string, hints: string[]): boolean {
  const lower = providerText.toLowerCase()
  return hints.some(hint => {
    const cleaned = hint.trim().toLowerCase()
    return cleaned.length > 0 && lower.includes(cleaned)
  })
}

export function deriveTokenCapFromRecentErrors(
  logs: ErrorLogEntry[],
  providerHints: string[],
  now: number = Date.now(),
): number | null {
  if (!Array.isArray(logs) || logs.length === 0) return null
  if (!Array.isArray(providerHints) || providerHints.length === 0) return null

  let cap: number | null = null

  for (const entry of logs) {
    if (!entry?.at || now - entry.at > TOKEN_WINDOW_MS) continue
    const route = (entry.route ?? '').toLowerCase()
    if (!route.includes('cloud')) continue

    const provider = (entry.provider ?? '').toLowerCase()
    if (!provider || !matchesProviderHint(provider, providerHints)) continue

    const affordable = extractAffordableTokensFromError(entry.message ?? '')
    if (!affordable) continue

    const suggested = Math.max(MIN_SAFE_COMPLETION_TOKENS, affordable - RETRY_SAFETY_MARGIN)
    cap = cap === null ? suggested : Math.min(cap, suggested)
  }

  return cap
}

export function derivePromptLimitFromRecentErrors(
  logs: ErrorLogEntry[],
  providerHints: string[],
  now: number = Date.now(),
): number | null {
  if (!Array.isArray(logs) || logs.length === 0) return null
  if (!Array.isArray(providerHints) || providerHints.length === 0) return null

  let limit: number | null = null

  for (const entry of logs) {
    if (!entry?.at || now - entry.at > TOKEN_WINDOW_MS) continue
    const route = (entry.route ?? '').toLowerCase()
    if (!route.includes('cloud')) continue

    const provider = (entry.provider ?? '').toLowerCase()
    if (!provider || !matchesProviderHint(provider, providerHints)) continue

    const extracted = extractPromptLimitFromError(entry.message ?? '')
    if (!extracted) continue

    limit = limit === null ? extracted : Math.min(limit, extracted)
  }

  return limit
}
