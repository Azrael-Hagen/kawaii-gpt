import type { ErrorAnalysis, ErrorLogEntry, Settings } from '@/types'

const MAX_ERROR_LOGS = 30

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function analyzeErrorMessage(message: string, context?: { provider?: string; route?: string; autoRepairApplied?: boolean }): ErrorAnalysis {
  const lower = compact(message).toLowerCase()

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

  const reportMarkdown = [
    '# KawaiiGPT Error Report',
    '',
    `- Timestamp: ${new Date().toISOString()}`,
    `- Source route: ${context?.route || 'unknown'}`,
    `- Provider: ${context?.provider || 'unknown'}`,
    `- Category: ${category}`,
    `- Auto repair tried: ${autoRepairTried ? 'yes' : 'no'}`,
    `- Auto repair applied: ${autoRepairApplied ? 'yes' : 'no'}`,
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
    autoRepairTried,
    autoRepairApplied,
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
}): ErrorLogEntry {
  const analysis = analyzeErrorMessage(input.message, {
    provider: input.provider,
    route: input.route,
    autoRepairApplied: input.autoRepairApplied,
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

export function appendErrorLog(settings: Settings, entry: ErrorLogEntry): Pick<Settings, 'errorLogs' | 'lastErrorReport'> {
  const nextLogs = [entry, ...(settings.errorLogs ?? [])].slice(0, MAX_ERROR_LOGS)
  return {
    errorLogs: nextLogs,
    lastErrorReport: entry.analysis.autoRepairApplied ? settings.lastErrorReport : entry.analysis.reportMarkdown,
  }
}