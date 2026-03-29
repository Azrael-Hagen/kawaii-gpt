import { LegacyEngineClient } from '@/services/aiClient'
import type { Settings } from '@/types'

export interface LegacyRuntimeSnapshot {
  running: boolean
  pid?: number
  command?: string
  lastError?: string
}

function isLocalLegacyEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

export async function ensureLegacyRuntimeReady(
  settings: Pick<Settings, 'legacyEngineBaseUrl' | 'legacyRuntimeCommand' | 'legacyRuntimeArgs' | 'legacyRuntimeCwd'>,
  apiKey?: string,
): Promise<{ ready: boolean; status: LegacyRuntimeSnapshot | null }> {
  const client = new LegacyEngineClient(settings.legacyEngineBaseUrl, apiKey)
  if (await client.checkConnection()) {
    const status = await window.api?.legacyStatus?.().catch(() => null)
    return { ready: true, status: status ?? null }
  }

  const status = await window.api?.legacyStatus?.().catch(() => null)
  if (!isLocalLegacyEndpoint(settings.legacyEngineBaseUrl) || !window.api?.legacyStart) {
    return { ready: false, status: status ?? null }
  }

  const next = status?.running
    ? status
    : await window.api?.legacyStart?.({
        command: settings.legacyRuntimeCommand,
        args: settings.legacyRuntimeArgs,
        cwd: settings.legacyRuntimeCwd,
      }).catch(() => null)

  for (let attempt = 0; attempt < 6; attempt++) {
    if (await client.checkConnection()) {
      return { ready: true, status: next ?? null }
    }
    await sleep(500)
  }

  return { ready: false, status: next ?? status ?? null }
}