export type ChatTraceStatus = 'success' | 'failed' | 'aborted'

export interface ChatTraceEvent {
  name: string
  at: number
  sinceStartMs: number
  attrs?: Record<string, string | number | boolean | null>
}

export interface ChatTrace {
  id: string
  startedAt: number
  finishedAt?: number
  durationMs?: number
  status?: ChatTraceStatus
  meta: {
    providerMode: string
    model: string
    promptChars: number
    attachmentCount: number
  }
  events: ChatTraceEvent[]
}

const MAX_TRACES = 80
const MAX_EVENTS_PER_TRACE = 120
const traces = new Map<string, ChatTrace>()
const traceOrder: string[] = []

function now(): number {
  return Date.now()
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function trimIfNeeded(): void {
  while (traceOrder.length > MAX_TRACES) {
    const oldest = traceOrder.shift()
    if (!oldest) break
    traces.delete(oldest)
  }
}

function normalizeAttrs(
  attrs?: Record<string, unknown>,
): Record<string, string | number | boolean | null> | undefined {
  if (!attrs) return undefined
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value
      continue
    }
    out[key] = String(value)
  }
  return out
}

export function startChatTrace(meta: ChatTrace['meta']): string {
  const id = createId()
  const startedAt = now()

  traces.set(id, {
    id,
    startedAt,
    meta,
    events: [],
  })
  traceOrder.push(id)
  trimIfNeeded()

  return id
}

export function addChatTraceEvent(
  traceId: string,
  name: string,
  attrs?: Record<string, unknown>,
): void {
  const trace = traces.get(traceId)
  if (!trace) return

  const at = now()
  const event: ChatTraceEvent = {
    name,
    at,
    sinceStartMs: Math.max(0, at - trace.startedAt),
    attrs: normalizeAttrs(attrs),
  }

  trace.events.push(event)
  if (trace.events.length > MAX_EVENTS_PER_TRACE) {
    trace.events.splice(0, trace.events.length - MAX_EVENTS_PER_TRACE)
  }
}

export function finishChatTrace(
  traceId: string,
  status: ChatTraceStatus,
  attrs?: Record<string, unknown>,
): void {
  const trace = traces.get(traceId)
  if (!trace || trace.finishedAt) return

  const finishedAt = now()
  trace.finishedAt = finishedAt
  trace.durationMs = Math.max(0, finishedAt - trace.startedAt)
  trace.status = status

  if (attrs) {
    addChatTraceEvent(traceId, 'chat_finished', attrs)
  }
}

export function getRecentChatTraces(limit = 20): ChatTrace[] {
  const ids = traceOrder.slice(-Math.max(1, limit)).reverse()
  return ids
    .map(id => traces.get(id))
    .filter((item): item is ChatTrace => Boolean(item))
}

export function clearChatTraces(): void {
  traces.clear()
  traceOrder.length = 0
}

export function summarizeChatTrace(trace: ChatTrace): string {
  const header = [
    `trace=${trace.id}`,
    `status=${trace.status ?? 'unknown'}`,
    `durationMs=${trace.durationMs ?? 0}`,
    `mode=${trace.meta.providerMode}`,
    `model=${trace.meta.model}`,
    `promptChars=${trace.meta.promptChars}`,
    `attachments=${trace.meta.attachmentCount}`,
  ].join(' ')

  const events = trace.events
    .slice(-12)
    .map(event => {
      const attrs = event.attrs
        ? Object.entries(event.attrs)
            .map(([k, v]) => `${k}=${v}`)
            .join(',')
        : ''
      return `[+${event.sinceStartMs}ms] ${event.name}${attrs ? ` {${attrs}}` : ''}`
    })
    .join('\n')

  return events ? `${header}\n${events}` : header
}
