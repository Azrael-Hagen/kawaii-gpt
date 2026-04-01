import type { Role, Settings } from '@/types'

export type RouteTarget = 'local' | 'cloud' | 'legacy'

export interface RouteDecision {
  target: RouteTarget
  reason: string
  maxTokens: number
  temperature: number
  useWebSearch: boolean
  generateImage: boolean
  imagePrompt: string
}

const WEB_HINTS = [
  'buscar', 'busca', 'búsqueda', 'web', 'internet',
  'hoy', 'noticia', 'noticias', 'actual', 'actualizado',
  'último', 'latest', 'news',
]

const CREATIVE_HINTS = ['cuento', 'historia', 'creative', 'poema', 'novela']
const CODE_HINTS = ['código', 'code', 'bug', 'test', 'typescript', 'python', 'api']
const CLOUD_RECOVERY_BACKOFF_MS = 90_000
const LOCAL_AVOIDANCE_WINDOW_MS = 10 * 60_000
const LEGACY_AVOIDANCE_WINDOW_MS = 10 * 60_000

// ── Image generation detection ────────────────────────────────────────────────

const IMAGE_EXPLICIT_PREFIXES = ['/img ', '/imagen ', '/draw ', '/generate image ']
const IMAGE_INTENT_PATTERNS = [
  'genera una imagen', 'generar imagen', 'crea una imagen', 'crear imagen',
  'dibuja ', 'dibújame', 'dibujame',
  'generate an image', 'create an image', 'draw a ', 'draw me ',
  'make an image', 'show me an image of', 'ilustración de', 'ilustra ',
]

export function shouldGenerateImage(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim()
  if (IMAGE_EXPLICIT_PREFIXES.some(p => lower.startsWith(p))) return true
  return IMAGE_INTENT_PATTERNS.some(p => lower.includes(p))
}

export function extractImagePrompt(prompt: string): string {
  const lower = prompt.trim().toLowerCase()
  for (const prefix of IMAGE_EXPLICIT_PREFIXES) {
    if (lower.startsWith(prefix)) return prompt.trim().slice(prefix.length).trim()
  }
  return prompt.trim()
}

export function shouldUseWebSearch(prompt: string): boolean {
  const text = prompt.toLowerCase()
  return WEB_HINTS.some(h => text.includes(h))
}

export function selectRoute(settings: Settings, prompt: string): RouteDecision {
  const text = prompt.trim().toLowerCase()
  const wantsWeb = settings.webSearchEnabled && shouldUseWebSearch(text)
  const wantsImage = settings.imageGenEnabled && shouldGenerateImage(prompt)
  const imagePrompt = wantsImage ? extractImagePrompt(prompt) : ''

  if (settings.provider === 'ollama') {
    return {
      target: 'local',
      reason: 'Manual local mode',
      maxTokens: adaptMaxTokens(settings.localMaxTokens, text),
      temperature: adaptTemperature(settings.temperature, text),
      useWebSearch: false,
      generateImage: false,
      imagePrompt: '',
    }
  }

  if (settings.provider === 'openai-compatible') {
    return {
      target: 'cloud',
      reason: 'Manual cloud mode',
      maxTokens: adaptMaxTokens(settings.cloudMaxTokens, text),
      temperature: adaptTemperature(settings.temperature, text),
      useWebSearch: wantsWeb,
      generateImage: wantsImage,
      imagePrompt,
    }
  }

  if (settings.provider === 'legacy-engine') {
    return {
      target: 'legacy',
      reason: 'Manual legacy engine mode',
      maxTokens: adaptMaxTokens(settings.cloudMaxTokens, text),
      temperature: adaptTemperature(settings.temperature, text),
      useWebSearch: wantsWeb,
      generateImage: false,
      imagePrompt: '',
    }
  }

  // Smart mode
  if (wantsImage) {
    return {
      target: 'cloud',
      reason: 'Smart mode: image generation requires cloud',
      maxTokens: adaptMaxTokens(settings.cloudMaxTokens, text),
      temperature: adaptTemperature(settings.temperature, text),
      useWebSearch: false,
      generateImage: true,
      imagePrompt,
    }
  }

  if (wantsWeb) {
    return {
      target: 'cloud',
      reason: 'Smart mode routed to cloud for web-aware query',
      maxTokens: adaptMaxTokens(settings.cloudMaxTokens, text),
      temperature: adaptTemperature(settings.temperature, text),
      useWebSearch: true,
      generateImage: false,
      imagePrompt: '',
    }
  }

  if (shouldAvoidLocalInSmart(settings)) {
    return {
      target: 'cloud',
      reason: 'Smart mode routed to cloud because local runtime is unstable',
      maxTokens: adaptMaxTokens(settings.cloudMaxTokens, text),
      temperature: adaptTemperature(settings.temperature, text),
      useWebSearch: false,
      generateImage: false,
      imagePrompt: '',
    }
  }

  if (shouldBackoffCloud(settings)) {
    return {
      target: 'local',
      reason: 'Smart mode: temporary cloud cooldown after recent network failure',
      maxTokens: adaptMaxTokens(settings.localMaxTokens, text),
      temperature: adaptTemperature(settings.temperature, text),
      useWebSearch: false,
      generateImage: false,
      imagePrompt: '',
    }
  }

  if (
    settings.enableLegacyEngine &&
    CREATIVE_HINTS.some(h => text.includes(h)) &&
    !shouldAvoidLegacyInSmart(settings)
  ) {
    return {
      target: 'legacy',
      reason: 'Smart mode routed to legacy for creative prompt',
      maxTokens: adaptMaxTokens(settings.cloudMaxTokens, text),
      temperature: adaptTemperature(settings.temperature, text),
      useWebSearch: false,
      generateImage: false,
      imagePrompt: '',
    }
  }

  if (text.length >= settings.smartLongPromptThreshold) {
    return {
      target: 'cloud',
      reason: 'Smart mode routed to cloud for long prompt',
      maxTokens: adaptMaxTokens(settings.cloudMaxTokens, text),
      temperature: adaptTemperature(settings.temperature, text),
      useWebSearch: false,
      generateImage: false,
      imagePrompt: '',
    }
  }

  return {
    target: 'local',
    reason: 'Smart mode routed to local for short prompt efficiency',
    maxTokens: adaptMaxTokens(settings.localMaxTokens, text),
    temperature: adaptTemperature(settings.temperature, text),
    useWebSearch: false,
    generateImage: false,
    imagePrompt: '',
  }
}

export function resolveModelForRoute(
  route: RouteTarget,
  settings: Settings,
  fallback: string,
): string {
  if (route === 'local') return settings.localModel || fallback
  if (route === 'legacy') return settings.legacyModel || settings.cloudModel || fallback
  return settings.cloudModel || fallback
}

export function prependWebContext(
  messages: Array<{ role: Role; content: string }>,
  context: Array<{ title: string; snippet: string; url: string }>,
): Array<{ role: Role; content: string }> {
  if (context.length === 0) return messages

  const blocks = context
    .map((r, i) => `${i + 1}. ${r.title}\n${r.snippet}\n${r.url}`)
    .join('\n\n')

  return [
    {
      role: 'user',
      content:
        'Contexto web reciente (no siempre exacto, verificar si es crítico):\n\n' +
        blocks +
        '\n\nSi es útil, úsalo para responder mejor con citas breves de fuente.',
    },
    ...messages,
  ]
}

function adaptMaxTokens(base: number, text: string): number {
  if (text.includes('resumen corto') || text.includes('short summary')) return Math.min(base, 220)
  if (text.includes('paso a paso') || text.includes('step by step')) return Math.max(base, 800)
  if (text.length <= 120) return Math.min(base, 420)
  if (text.length <= 280) return Math.min(base, 700)
  return base
}

function adaptTemperature(base: number, text: string): number {
  if (CODE_HINTS.some(h => text.includes(h))) return Math.min(base, 0.4)
  if (CREATIVE_HINTS.some(h => text.includes(h))) return Math.max(base, 0.9)
  return base
}

function shouldBackoffCloud(settings: Settings): boolean {
  if (settings.provider !== 'smart') return false
  if (!settings.autoFailover || !settings.localModel) return false
  if (shouldAvoidLocalInSmart(settings)) return false

  const last = settings.cloudDiagnostics
  if (!last?.lastError || !last.lastAt) return false
  if (Date.now() - last.lastAt > CLOUD_RECOVERY_BACKOFF_MS) return false

  const lower = last.lastError.toLowerCase()
  return (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('econnrefused')
  )
}

function shouldAvoidLocalInSmart(settings: Settings): boolean {
  if (settings.provider !== 'smart') return false
  const logs = settings.errorLogs ?? []
  if (logs.length === 0) return false

  return logs.some(entry => {
    if (!entry.at || Date.now() - entry.at > LOCAL_AVOIDANCE_WINDOW_MS) return false
    const route = (entry.route ?? '').toLowerCase()
    const message = (entry.message ?? '').toLowerCase()

    const localRoute = route === 'local' || route.includes('->local')
    if (!localRoute) return false

    return (
      message.includes('memory layout cannot be allocated') ||
      message.includes('out of memory') ||
      message.includes('cannot allocate') ||
      (message.includes('ollama error (500)') && message.includes('memory'))
    )
  })
}

function shouldAvoidLegacyInSmart(settings: Settings): boolean {
  if (settings.provider !== 'smart') return false
  const logs = settings.errorLogs ?? []
  if (logs.length === 0) return false

  const recentLegacyFailures = logs.filter(entry => {
    if (!entry.at || Date.now() - entry.at > LEGACY_AVOIDANCE_WINDOW_MS) return false
    const route = (entry.route ?? '').toLowerCase()
    const message = (entry.message ?? '').toLowerCase()
    if (!(route === 'legacy' || route.includes('->legacy'))) return false

    return (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('failed to fetch') ||
      message.includes('econnrefused') ||
      message.includes('no disponible')
    )
  })

  return recentLegacyFailures.length >= 2
}

