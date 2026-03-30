import type { ErrorAnalysis, ErrorKnowledgeCase, ErrorLogEntry, Settings } from '@/types'

const MAX_ERROR_LOGS = 30
const MAX_ERROR_CASES = 60
const MAX_RECOGNITION_NOTES = 14
const MAX_SAMPLE_MESSAGES = 3

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function fingerprintError(message: string): string {
  return compact(message)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '{url}')
    .replace(/\b\d{3}\b/g, '{code}')
    .replace(/\b\d+ms\b/g, '{latency}')
    .replace(/\b[a-f0-9]{8,}\b/gi, '{id}')
}

function inferRepairAction(category: ErrorAnalysis['category'], route?: string, autoRepairApplied?: boolean): string {
  if (autoRepairApplied && route === 'cloud->local') return 'switch_to_local'
  if (autoRepairApplied && route === 'cloud->legacy') return 'switch_to_legacy'
  if (autoRepairApplied && route === 'legacy->local') return 'legacy_to_local'
  if (category === 'auth') return 'check_api_key'
  if (category === 'model') return 'switch_model'
  if (category === 'runtime') return 'restart_runtime'
  if (category === 'network') return 'retry_or_change_provider'
  if (category === 'timeout') return 'reduce_load_or_retry'
  if (category === 'policy') return 'rotate_provider'
  return 'generate_report'
}

function limitUnique(values: string[], max: number): string[] {
  const normalized = values
    .map(item => compact(item))
    .filter(Boolean)
  return [...new Set(normalized)].slice(0, max)
}

function extractRecognitionNotes(
  message: string,
  category: ErrorAnalysis['category'],
  context?: { provider?: string; route?: string; autoRepairApplied?: boolean; learnedSuggestion?: string },
): string[] {
  const lower = compact(message).toLowerCase()
  const notes: string[] = []

  notes.push(`category:${category}`)
  if (context?.provider) notes.push(`provider:${context.provider}`)
  if (context?.route) notes.push(`route:${context.route}`)
  if (context?.autoRepairApplied) notes.push('status:auto-repaired')
  if (context?.learnedSuggestion) notes.push(`learned:${context.learnedSuggestion}`)

  const statusCode = lower.match(/\b(4\d\d|5\d\d)\b/)?.[1]
  if (statusCode) notes.push(`http:${statusCode}`)

  if (lower.includes('failed to fetch')) notes.push('signal:failed-fetch')
  if (lower.includes('timeout') || lower.includes('timed out')) notes.push('signal:timeout')
  if (lower.includes('econnrefused')) notes.push('signal:econnrefused')
  if (lower.includes('cors')) notes.push('signal:cors')
  if (lower.includes('invalid api key') || lower.includes('unauthorized')) notes.push('signal:auth-key')
  if (lower.includes('model') && lower.includes('not found')) notes.push('signal:model-not-found')
  if (lower.includes('resource not found')) notes.push('signal:resource-not-found')
  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('429')) notes.push('signal:rate-limit')
  if (lower.includes('openrouter')) notes.push('provider-hint:openrouter')
  if (lower.includes('ollama')) notes.push('provider-hint:ollama')
  if (lower.includes('legacy') || lower.includes('kawaii')) notes.push('provider-hint:legacy')

  return limitUnique(notes, MAX_RECOGNITION_NOTES)
}

function countNoteOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const rightSet = new Set(right)
  return left.filter(item => rightSet.has(item)).length
}

function scoreCase(
  candidate: ErrorKnowledgeCase,
  fingerprint: string,
  category: ErrorAnalysis['category'],
  provider?: string,
  route?: string,
  recognitionNotes: string[] = [],
): number {
  let score = 0
  if (candidate.fingerprint === fingerprint) score += 6
  if (candidate.category === category) score += 3
  if (candidate.provider && provider && candidate.provider === provider) score += 2
  if (candidate.route && route && candidate.route === route) score += 2
  score += Math.min(3, countNoteOverlap(candidate.recognitionNotes ?? [], recognitionNotes))
  score += Math.min(candidate.successCount, 4)
  return score
}

function predictRepairFromKnowledgeBase(
  knowledgeBase: ErrorKnowledgeCase[],
  fingerprint: string,
  category: ErrorAnalysis['category'],
  provider?: string,
  route?: string,
  recognitionNotes: string[] = [],
): { suggestion?: string; confidence?: number } {
  if (knowledgeBase.length === 0) return {}

  const ranked = [...knowledgeBase]
    .map(item => ({ item, score: scoreCase(item, fingerprint, category, provider, route, recognitionNotes) }))
    .sort((left, right) => right.score - left.score)

  const best = ranked[0]
  if (!best || best.score < 5) return {}

  const confidence = Math.min(0.95, Math.max(0.35, best.item.successCount / Math.max(best.item.seenCount, 1)))
  return {
    suggestion: best.item.recommendedAction,
    confidence,
  }
}

export function getLearnedRepairRecommendation(
  settings: Settings,
  message: string,
  context?: { provider?: string; route?: string },
): { suggestion?: string; confidence?: number } {
  const fingerprint = fingerprintError(message)
  const analysis = analyzeErrorMessage(message, {
    provider: context?.provider,
    route: context?.route,
    knowledgeBase: settings.errorKnowledgeBase,
  })

  return predictRepairFromKnowledgeBase(
    settings.errorKnowledgeBase ?? [],
    fingerprint,
    analysis.category,
    context?.provider,
    context?.route,
    analysis.recognitionNotes,
  )
}

export function analyzeErrorMessage(
  message: string,
  context?: { provider?: string; route?: string; autoRepairApplied?: boolean; knowledgeBase?: ErrorKnowledgeCase[] },
): ErrorAnalysis {
  const lower = compact(message).toLowerCase()
  const fingerprint = fingerprintError(message)

  let category: ErrorAnalysis['category'] = 'unknown'
  let probableCause = 'Fallo no clasificado en la app o el proveedor.'
  let suggestedFix = 'Revisar el reporte generado y repetir la accion con diagnostico habilitado.'

  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('load failed')) {
    category = 'network'
    probableCause = 'Fallo de red, CORS, endpoint inaccesible o proveedor temporalmente caido.'
    suggestedFix = 'Verificar base URL, conectividad, VPN/proxy y disponibilidad del proveedor.'
  } else if (lower.includes('401') || lower.includes('403') || lower.includes('invalid api key') || lower.includes('unauthorized')) {
    category = 'auth'
    probableCause = 'API key invalida, ausente o con permisos insuficientes.'
    suggestedFix = 'Revisar la API key guardada en Opciones y confirmar permisos del endpoint.'
  } else if (lower.includes('model') && lower.includes('not found') || lower.includes('resource not found')) {
    category = 'model'
    probableCause = 'El modelo configurado no existe o no esta expuesto por ese proveedor.'
    suggestedFix = 'Cambiar el modelo en Opciones o usar seleccion automatica compatible.'
  } else if (lower.includes('timeout') || lower.includes('timed out')) {
    category = 'timeout'
    probableCause = 'El proveedor o runtime demoro demasiado en responder.'
    suggestedFix = 'Reducir carga del prompt, reintentar o usar otro proveedor/ruta.'
  } else if (lower.includes('runtime') || lower.includes('legacy') || lower.includes('ollama') || lower.includes('kawaii no disponible')) {
    category = 'runtime'
    probableCause = 'El runtime local/legacy no esta iniciado o no responde correctamente.'
    suggestedFix = 'Revisar runtime local, comando de arranque y endpoint configurado.'
  } else if (lower.includes('soft_refusal') || lower.includes('bloqueada') || lower.includes('policy')) {
    category = 'policy'
    probableCause = 'El proveedor devolvio una negativa o filtrado de contenido.'
    suggestedFix = 'Rotar de proveedor o usar una familia/modelo menos restrictivo.'
  }

  const autoRepairApplied = Boolean(context?.autoRepairApplied)
  const autoRepairTried = category === 'network' || category === 'timeout' || category === 'runtime' || category === 'policy'
  const recognitionNotes = extractRecognitionNotes(message, category, {
    provider: context?.provider,
    route: context?.route,
    autoRepairApplied,
  })
  const learned = predictRepairFromKnowledgeBase(
    context?.knowledgeBase ?? [],
    fingerprint,
    category,
    context?.provider,
    context?.route,
    recognitionNotes,
  )

  if (learned.suggestion) {
    suggestedFix = `Aprendizaje local sugiere: ${learned.suggestion}. ${suggestedFix}`
  }

  const reportMarkdown = [
    '# KawaiiGPT Error Report',
    '',
    `- Timestamp: ${new Date().toISOString()}`,
    `- Source route: ${context?.route || 'unknown'}`,
    `- Provider: ${context?.provider || 'unknown'}`,
    `- Category: ${category}`,
    `- Auto repair tried: ${autoRepairTried ? 'yes' : 'no'}`,
    `- Auto repair applied: ${autoRepairApplied ? 'yes' : 'no'}`,
    ...(learned.suggestion ? [`- Learned suggestion: ${learned.suggestion}`, `- Learned confidence: ${Math.round((learned.confidence ?? 0) * 100)}%`] : []),
    ...(recognitionNotes.length > 0 ? [`- Recognition notes: ${recognitionNotes.join(' | ')}`] : []),
    '',
    '## Error message',
    compact(message),
    '',
    '## Probable cause',
    probableCause,
    '',
    '## Suggested fix',
    suggestedFix,
  ].join('\n')

  return {
    category,
    probableCause,
    suggestedFix,
    recognitionNotes,
    autoRepairTried,
    autoRepairApplied,
    learnedSuggestion: learned.suggestion,
    learnedConfidence: learned.confidence,
    reportMarkdown,
  }
}

export function createErrorLogEntry(input: {
  source: ErrorLogEntry['source']
  severity?: ErrorLogEntry['severity']
  message: string
  provider?: string
  route?: string
  autoRepairApplied?: boolean
  knowledgeBase?: ErrorKnowledgeCase[]
}): ErrorLogEntry {
  const analysis = analyzeErrorMessage(input.message, {
    provider: input.provider,
    route: input.route,
    autoRepairApplied: input.autoRepairApplied,
    knowledgeBase: input.knowledgeBase,
  })

  return {
    id: createId(),
    source: input.source,
    severity: input.severity ?? 'error',
    message: compact(input.message),
    provider: input.provider,
    route: input.route,
    status: analysis.autoRepairApplied ? 'auto-repaired' : 'report-ready',
    at: Date.now(),
    analysis,
  }
}

export function updateErrorKnowledgeBase(
  knowledgeBase: ErrorKnowledgeCase[],
  entry: ErrorLogEntry,
): ErrorKnowledgeCase[] {
  const fingerprint = fingerprintError(entry.message)
  const recommendedAction = inferRepairAction(entry.analysis.category, entry.route, entry.analysis.autoRepairApplied)
  const existing = knowledgeBase.find(item =>
    item.fingerprint === fingerprint &&
    item.category === entry.analysis.category &&
    item.provider === entry.provider &&
    item.route === entry.route &&
    item.recommendedAction === recommendedAction,
  )

  if (existing) {
    return knowledgeBase
      .map(item => item.id === existing.id
        ? {
            ...item,
            seenCount: item.seenCount + 1,
            successCount: item.successCount + (entry.analysis.autoRepairApplied ? 1 : 0),
            lastSeenAt: entry.at,
            recognitionNotes: limitUnique([
              ...(item.recognitionNotes ?? []),
              ...(entry.analysis.recognitionNotes ?? []),
            ], MAX_RECOGNITION_NOTES),
            sampleMessages: limitUnique([
              ...(item.sampleMessages ?? []),
              entry.message,
            ], MAX_SAMPLE_MESSAGES),
          }
        : item)
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
      .slice(0, MAX_ERROR_CASES)
  }

  return [
    {
      id: createId(),
      fingerprint,
      category: entry.analysis.category,
      provider: entry.provider,
      route: entry.route,
      recommendedAction,
      recognitionNotes: entry.analysis.recognitionNotes,
      sampleMessages: [entry.message],
      seenCount: 1,
      successCount: entry.analysis.autoRepairApplied ? 1 : 0,
      lastSeenAt: entry.at,
    },
    ...knowledgeBase,
  ].slice(0, MAX_ERROR_CASES)
}

export function appendErrorLog(settings: Settings, entry: ErrorLogEntry): Pick<Settings, 'errorLogs' | 'lastErrorReport'> {
  const nextLogs = [entry, ...(settings.errorLogs ?? [])].slice(0, MAX_ERROR_LOGS)
  return {
    errorLogs: nextLogs,
    lastErrorReport: entry.analysis.autoRepairApplied ? settings.lastErrorReport : entry.analysis.reportMarkdown,
  }
}