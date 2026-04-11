type CircuitState = 'closed' | 'open' | 'half-open'

type FailureCategory = 'fatal' | 'throttle' | 'transient' | 'unknown'

interface CircuitEntry {
  state: CircuitState
  consecutiveFailures: number
  halfOpenSuccesses: number
  openedUntilMs: number
  halfOpenInFlight: boolean
  lastErrorAtMs: number
  lastCategory: FailureCategory | null
}

export interface CloudCircuitDecision {
  allowed: boolean
  state: CircuitState
  retryInMs: number
  reason: string
}

const circuits = new Map<string, CircuitEntry>()

const FATAL_THRESHOLD = 1
const TRANSIENT_THRESHOLD = 2
const HALF_OPEN_SUCCESS_TARGET = 2

const FATAL_BASE_OPEN_MS = 4 * 60_000
const THROTTLE_BASE_OPEN_MS = 20_000
const TRANSIENT_BASE_OPEN_MS = 12_000
const UNKNOWN_BASE_OPEN_MS = 15_000
const HALF_OPEN_COOLDOWN_MS = 1_500
const MAX_OPEN_MS = 8 * 60_000

let randomFn = Math.random

function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl ?? '').trim().toLowerCase()
}

function getOrCreateEntry(baseUrl: string): CircuitEntry {
  const key = normalizeBaseUrl(baseUrl)
  const existing = circuits.get(key)
  if (existing) return existing

  const created: CircuitEntry = {
    state: 'closed',
    consecutiveFailures: 0,
    halfOpenSuccesses: 0,
    openedUntilMs: 0,
    halfOpenInFlight: false,
    lastErrorAtMs: 0,
    lastCategory: null,
  }
  circuits.set(key, created)
  return created
}

function parseRetryAfterMs(message: string): number | null {
  const text = (message ?? '').toLowerCase()

  const direct = text.match(/retry-after\s*[:=]\s*(\d+)/i)
  if (direct?.[1]) {
    const seconds = Number(direct[1])
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000
  }

  const flexible = text.match(/retry(?:ing)?\s+(?:after|in)\s+(\d+)\s*(ms|msec|milliseconds|s|sec|secs|seconds|m|min|mins|minutes)?/i)
  if (!flexible?.[1]) return null

  const value = Number(flexible[1])
  if (!Number.isFinite(value) || value <= 0) return null

  const unit = (flexible[2] ?? 's').toLowerCase()
  if (unit.startsWith('ms') || unit.startsWith('msec')) return value
  if (unit.startsWith('m') && !unit.startsWith('ms')) return value * 60_000
  return value * 1000
}

function classifyFailure(message: string): FailureCategory {
  const lower = (message ?? '').toLowerCase()

  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('402') ||
    lower.includes('invalid api key') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('insufficient_quota') ||
    lower.includes('credit limit') ||
    (lower.includes('404') && (lower.includes('model') || lower.includes('endpoint') || lower.includes('no endpoints')))
  ) {
    return 'fatal'
  }

  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('slow down') ||
    lower.includes('throttl') ||
    lower.includes('503')
  ) {
    return 'throttle'
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('econnrefused') ||
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('504')
  ) {
    return 'transient'
  }

  return 'unknown'
}

function thresholdForCategory(category: FailureCategory): number {
  return category === 'fatal' ? FATAL_THRESHOLD : TRANSIENT_THRESHOLD
}

function baseOpenMsForCategory(category: FailureCategory): number {
  switch (category) {
    case 'fatal':
      return FATAL_BASE_OPEN_MS
    case 'throttle':
      return THROTTLE_BASE_OPEN_MS
    case 'transient':
      return TRANSIENT_BASE_OPEN_MS
    default:
      return UNKNOWN_BASE_OPEN_MS
  }
}

function computeJitteredWindowMs(category: FailureCategory, failures: number, retryAfterMs: number | null): number {
  const base = baseOpenMsForCategory(category)
  const multiplier = Math.min(6, Math.max(0, failures - 1))
  const cap = Math.min(MAX_OPEN_MS, base * (2 ** multiplier))
  const min = Math.max(1_000, Math.floor(cap * 0.4))
  const randomWindow = min + Math.floor(randomFn() * (cap - min + 1))
  const withProviderHint = retryAfterMs ? Math.max(randomWindow, retryAfterMs) : randomWindow
  return Math.max(base, Math.min(MAX_OPEN_MS, withProviderHint))
}

export function getCloudProviderCircuitDecision(baseUrl: string, nowMs = Date.now()): CloudCircuitDecision {
  const key = normalizeBaseUrl(baseUrl)
  if (!key) {
    return {
      allowed: true,
      state: 'closed',
      retryInMs: 0,
      reason: 'empty-base-url',
    }
  }

  const entry = getOrCreateEntry(key)

  if (entry.state === 'closed') {
    return {
      allowed: true,
      state: 'closed',
      retryInMs: 0,
      reason: 'closed',
    }
  }

  if (entry.state === 'open') {
    const retryInMs = Math.max(0, entry.openedUntilMs - nowMs)
    if (retryInMs > 0) {
      return {
        allowed: false,
        state: 'open',
        retryInMs,
        reason: 'open-waiting',
      }
    }

    entry.state = 'half-open'
    entry.halfOpenInFlight = false
    entry.halfOpenSuccesses = 0
  }

  if (entry.halfOpenInFlight) {
    return {
      allowed: false,
      state: 'half-open',
      retryInMs: HALF_OPEN_COOLDOWN_MS,
      reason: 'half-open-probe-in-flight',
    }
  }

  entry.halfOpenInFlight = true
  return {
    allowed: true,
    state: 'half-open',
    retryInMs: 0,
    reason: 'half-open-probe-allowed',
  }
}

export function markCloudProviderSuccess(baseUrl: string): void {
  const key = normalizeBaseUrl(baseUrl)
  if (!key) return

  const entry = getOrCreateEntry(key)
  if (entry.state === 'half-open') {
    entry.halfOpenInFlight = false
    entry.halfOpenSuccesses += 1
    if (entry.halfOpenSuccesses >= HALF_OPEN_SUCCESS_TARGET) {
      entry.state = 'closed'
      entry.consecutiveFailures = 0
      entry.halfOpenSuccesses = 0
      entry.openedUntilMs = 0
      entry.lastCategory = null
    }
    return
  }

  entry.state = 'closed'
  entry.consecutiveFailures = 0
  entry.halfOpenSuccesses = 0
  entry.halfOpenInFlight = false
  entry.openedUntilMs = 0
  entry.lastCategory = null
}

export function markCloudProviderFailure(baseUrl: string, message: string, nowMs = Date.now()): void {
  const key = normalizeBaseUrl(baseUrl)
  if (!key) return

  const entry = getOrCreateEntry(key)
  const category = classifyFailure(message)
  const retryAfterMs = parseRetryAfterMs(message)

  entry.lastErrorAtMs = nowMs
  entry.lastCategory = category
  entry.consecutiveFailures += 1

  if (entry.state === 'half-open') {
    entry.halfOpenInFlight = false
    entry.halfOpenSuccesses = 0
  }

  const threshold = thresholdForCategory(category)
  const shouldOpen = entry.state !== 'closed' || entry.consecutiveFailures >= threshold
  if (!shouldOpen) return

  const openWindowMs = computeJitteredWindowMs(category, entry.consecutiveFailures, retryAfterMs)
  entry.state = 'open'
  entry.openedUntilMs = nowMs + openWindowMs
  entry.halfOpenInFlight = false
  entry.halfOpenSuccesses = 0
}

export function clearCloudProviderCircuit(baseUrl: string): void {
  const key = normalizeBaseUrl(baseUrl)
  if (!key) return
  circuits.delete(key)
}

export function resetCloudCircuitBreaker(): void {
  circuits.clear()
}

export function __setCloudCircuitRandomForTests(random: () => number): void {
  randomFn = random
}

export function __resetCloudCircuitRandomForTests(): void {
  randomFn = Math.random
}
