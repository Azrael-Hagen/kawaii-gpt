import type { ErrorLogEntry } from '@/types'

const TOKEN_WINDOW_MS = 6 * 60 * 60_000
const MIN_SAFE_COMPLETION_TOKENS = 120
const RETRY_SAFETY_MARGIN = 24

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
