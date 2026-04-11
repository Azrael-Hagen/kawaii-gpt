import type { AdditionalProvider, Settings } from '@/types'

export interface ProviderSecretsSnapshot {
  mainApiKey: string
  additionalApiKeys: Record<string, string>
}

export interface ProviderRuntimeSnapshot {
  mode: 'dev' | 'packaged' | 'unknown'
  url: string
  origin: string
}

export interface ProviderConfigExportPayload {
  schema: 'kawaii-gpt-provider-config'
  version: 1
  exportedAt: string
  runtime: ProviderRuntimeSnapshot
  providerConfig: {
    provider: Settings['provider']
    providerBaseUrl: string
    localBaseUrl: string
    cloudBaseUrl: string
    legacyEngineBaseUrl: string
    defaultModel: string
    localModel: string
    cloudModel: string
    legacyModel: string
    additionalProviders: AdditionalProvider[]
    autoFailover: boolean
    preferFreeTier: boolean
    prioritizeUnrestricted: boolean
    smartLongPromptThreshold: number
    cloudMaxTokens: number
    localMaxTokens: number
    webSearchEnabled: boolean
    webSearchMaxResults: number
    enableLegacyEngine: boolean
    legacyRuntimeCommand: string
    legacyRuntimeArgs: string
    legacyRuntimeCwd: string
  }
  secrets: ProviderSecretsSnapshot
}

export interface ParsedProviderConfigImport {
  providerConfig: ProviderConfigExportPayload['providerConfig']
  secrets: ProviderSecretsSnapshot
  runtime: ProviderRuntimeSnapshot | null
}

function normalizeAdditionalProviders(raw: unknown): AdditionalProvider[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const data = item as Record<string, unknown>
      const idValue = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : `ap${index + 1}`
      return {
        id: idValue,
        name: typeof data.name === 'string' ? data.name : '',
        baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : '',
        enabled: Boolean(data.enabled),
      }
    })
    .filter((item): item is AdditionalProvider => Boolean(item))
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function buildProviderConfigExportPayload(
  settings: Settings,
  secrets: ProviderSecretsSnapshot,
  runtime: ProviderRuntimeSnapshot,
): ProviderConfigExportPayload {
  return {
    schema: 'kawaii-gpt-provider-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    runtime,
    providerConfig: {
      provider: settings.provider,
      providerBaseUrl: settings.providerBaseUrl,
      localBaseUrl: settings.localBaseUrl,
      cloudBaseUrl: settings.cloudBaseUrl,
      legacyEngineBaseUrl: settings.legacyEngineBaseUrl,
      defaultModel: settings.defaultModel,
      localModel: settings.localModel,
      cloudModel: settings.cloudModel,
      legacyModel: settings.legacyModel,
      additionalProviders: (settings.additionalProviders ?? []).map(item => ({ ...item })),
      autoFailover: settings.autoFailover,
      preferFreeTier: settings.preferFreeTier,
      prioritizeUnrestricted: settings.prioritizeUnrestricted,
      smartLongPromptThreshold: settings.smartLongPromptThreshold,
      cloudMaxTokens: settings.cloudMaxTokens,
      localMaxTokens: settings.localMaxTokens,
      webSearchEnabled: settings.webSearchEnabled,
      webSearchMaxResults: settings.webSearchMaxResults,
      enableLegacyEngine: settings.enableLegacyEngine,
      legacyRuntimeCommand: settings.legacyRuntimeCommand,
      legacyRuntimeArgs: settings.legacyRuntimeArgs,
      legacyRuntimeCwd: settings.legacyRuntimeCwd,
    },
    secrets: {
      mainApiKey: secrets.mainApiKey || '',
      additionalApiKeys: { ...(secrets.additionalApiKeys ?? {}) },
    },
  }
}

export function parseProviderConfigImportPayload(raw: unknown): ParsedProviderConfigImport | null {
  if (!raw || typeof raw !== 'object') return null
  const root = raw as Record<string, unknown>

  const configRaw = root.providerConfig
  const secretsRaw = root.secrets
  if (!configRaw || typeof configRaw !== 'object') return null

  const config = configRaw as Record<string, unknown>
  const secrets = (secretsRaw && typeof secretsRaw === 'object')
    ? (secretsRaw as Record<string, unknown>)
    : {}

  const additionalApiKeysRaw = secrets.additionalApiKeys
  const additionalApiKeys = additionalApiKeysRaw && typeof additionalApiKeysRaw === 'object'
    ? Object.fromEntries(
      Object.entries(additionalApiKeysRaw as Record<string, unknown>)
        .map(([key, value]) => [key, asString(value)]),
    )
    : {}

  const runtimeRaw = root.runtime
  const runtime = runtimeRaw && typeof runtimeRaw === 'object'
    ? {
      mode: (() => {
        const mode = asString((runtimeRaw as Record<string, unknown>).mode, 'unknown')
        return mode === 'dev' || mode === 'packaged' ? mode : 'unknown'
      })(),
      url: asString((runtimeRaw as Record<string, unknown>).url),
      origin: asString((runtimeRaw as Record<string, unknown>).origin),
    }
    : null

  return {
    providerConfig: {
      provider: ((): Settings['provider'] => {
        const value = asString(config.provider, 'smart')
        if (value === 'ollama' || value === 'openai-compatible' || value === 'smart' || value === 'legacy-engine') {
          return value
        }
        return 'smart'
      })(),
      providerBaseUrl: asString(config.providerBaseUrl),
      localBaseUrl: asString(config.localBaseUrl, 'http://localhost:11434'),
      cloudBaseUrl: asString(config.cloudBaseUrl, 'https://openrouter.ai/api/v1'),
      legacyEngineBaseUrl: asString(config.legacyEngineBaseUrl, 'http://127.0.0.1:8765/v1'),
      defaultModel: asString(config.defaultModel),
      localModel: asString(config.localModel),
      cloudModel: asString(config.cloudModel),
      legacyModel: asString(config.legacyModel),
      additionalProviders: normalizeAdditionalProviders(config.additionalProviders),
      autoFailover: asBool(config.autoFailover, true),
      preferFreeTier: asBool(config.preferFreeTier, true),
      prioritizeUnrestricted: asBool(config.prioritizeUnrestricted, true),
      smartLongPromptThreshold: asNumber(config.smartLongPromptThreshold, 700),
      cloudMaxTokens: asNumber(config.cloudMaxTokens, 1200),
      localMaxTokens: asNumber(config.localMaxTokens, 400),
      webSearchEnabled: asBool(config.webSearchEnabled, true),
      webSearchMaxResults: asNumber(config.webSearchMaxResults, 5),
      enableLegacyEngine: asBool(config.enableLegacyEngine, false),
      legacyRuntimeCommand: asString(config.legacyRuntimeCommand, 'python'),
      legacyRuntimeArgs: asString(config.legacyRuntimeArgs, 'kawai.py --api --port 8765'),
      legacyRuntimeCwd: asString(config.legacyRuntimeCwd),
    },
    secrets: {
      mainApiKey: asString(secrets.mainApiKey),
      additionalApiKeys,
    },
    runtime,
  }
}
