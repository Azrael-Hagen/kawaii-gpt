export type KnownCloudProvider = 'openrouter' | 'openai' | 'groq' | 'gemini' | 'together' | 'unknown'

interface ProviderCatalog {
  fast: string[]
  strong: string[]
  fallback: string[]
}

interface ProviderImageCatalog {
  supported: boolean
  preferred: string[]
}

const CATALOG: Record<KnownCloudProvider, ProviderCatalog> = {
  openrouter: {
    fast: [
      'openai/gpt-5.4-nano',
      'openai/gpt-5.4-mini',
      'google/gemini-2.0-flash-exp:free',
    ],
    strong: [
      'openai/gpt-5.4',
      'openai/gpt-5.4-mini',
      'anthropic/claude-3.5-sonnet',
      'deepseek/deepseek-r1',
    ],
    fallback: ['meta-llama/llama-3.3-70b-instruct'],
  },
  openai: {
    fast: ['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-4o-mini'],
    strong: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-4.1'],
    fallback: ['gpt-4.1-mini'],
  },
  groq: {
    fast: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    strong: ['llama-3.3-70b-versatile', 'deepseek-r1-distill-llama-70b'],
    fallback: ['mixtral-8x7b-32768'],
  },
  gemini: {
    fast: ['gemini-1.5-flash', 'gemini-2.0-flash'],
    strong: ['gemini-2.0-pro', 'gemini-1.5-pro'],
    fallback: ['gemini-1.5-flash'],
  },
  together: {
    fast: ['meta-llama/Llama-3.2-3B-Instruct-Turbo', 'meta-llama/Llama-3.1-8B-Instruct-Turbo'],
    strong: ['meta-llama/Llama-3.3-70B-Instruct-Turbo-Free', 'deepseek-ai/DeepSeek-R1'],
    fallback: ['Qwen/Qwen2.5-72B-Instruct-Turbo'],
  },
  unknown: {
    fast: ['gpt-5.4-mini', 'gpt-4o-mini', 'gemini-1.5-flash'],
    strong: ['gpt-5.4', 'claude-3.5-sonnet', 'llama-3.3-70b'],
    fallback: ['gpt-5.4-nano'],
  },
}

const IMAGE_CATALOG: Record<KnownCloudProvider, ProviderImageCatalog> = {
  openrouter: {
    supported: true,
    preferred: ['openai/gpt-image-1', 'openai/dall-e-3'],
  },
  openai: {
    supported: true,
    preferred: ['gpt-image-1', 'dall-e-3'],
  },
  groq: {
    supported: false,
    preferred: [],
  },
  gemini: {
    supported: true,
    preferred: ['imagen-3.0-generate-002'],
  },
  together: {
    supported: true,
    preferred: [
      'black-forest-labs/FLUX.1-schnell-Free',
      'black-forest-labs/FLUX.1-dev',
    ],
  },
  unknown: {
    supported: true,
    preferred: [],
  },
}

function normalizeUrl(baseUrl: string): string {
  return baseUrl.toLowerCase().replace(/\/+$/, '')
}

function isLikelyImageModelName(modelName: string): boolean {
  return /(dall|gpt-image|image|imagen|flux|sdxl|stable-diffusion|playground|recraft|kandinsky|pixart)/i.test(modelName)
}

function isLikelyChatOnlyModelName(modelName: string): boolean {
  return /(instruct|chat|llama|qwen|claude|sonnet|haiku|r1|gpt-4|gpt-5|deepseek|mixtral|gemini-.*(flash|pro))/i.test(modelName)
}

export function detectCloudProvider(baseUrl: string): KnownCloudProvider {
  const n = normalizeUrl(baseUrl)
  if (n.includes('openrouter.ai')) return 'openrouter'
  if (n.includes('api.openai.com')) return 'openai'
  if (n.includes('api.groq.com')) return 'groq'
  if (n.includes('generativelanguage.googleapis.com') || n.includes('googleapis.com')) return 'gemini'
  if (n.includes('api.together.xyz')) return 'together'
  return 'unknown'
}

export function normalizeImageModelForProvider(baseUrl: string, modelName: string): string {
  const model = modelName.trim()
  if (!model) return model

  const provider = detectCloudProvider(baseUrl)
  if (provider === 'openrouter') {
    return model.includes('/') ? model : `openai/${model}`
  }
  if (provider === 'openai') {
    return model.replace(/^openai\//, '')
  }
  return model
}

export function providerSupportsImageGeneration(baseUrl: string): boolean {
  const provider = detectCloudProvider(baseUrl)
  return IMAGE_CATALOG[provider].supported
}

export function getImageModelCandidatesForBaseUrl(baseUrl: string, configuredModel: string): string[] {
  const provider = detectCloudProvider(baseUrl)
  const conf = normalizeImageModelForProvider(baseUrl, configuredModel)
  const safeConfigured = conf && (!isLikelyChatOnlyModelName(conf) || isLikelyImageModelName(conf))
    ? conf
    : ''
  const preferred = IMAGE_CATALOG[provider].preferred
    .map(m => normalizeImageModelForProvider(baseUrl, m))

  if (!IMAGE_CATALOG[provider].supported) return []

  const ordered = [safeConfigured, ...preferred].filter(Boolean)
  return Array.from(new Set(ordered))
}

export function getCatalogModelsForBaseUrl(baseUrl: string): string[] {
  const p = detectCloudProvider(baseUrl)
  const group = CATALOG[p]
  return Array.from(new Set([...group.fast, ...group.strong, ...group.fallback]))
}

function isComplexPrompt(prompt: string): boolean {
  const text = prompt.toLowerCase()
  if (text.length > 220) return true
  return /c[oó]digo|code|debug|arquitectura|an[aá]lisis|analisis|plan|refactor|algoritmo|multi-step|step by step/.test(text)
}

export function pickSmartModel(prompt: string, available: string[], preferred?: string): string {
  return pickSmartModelWithOptions(prompt, available, preferred, {
    prioritizeUnrestricted: false,
    preferFreeTier: false,
  })
}

export function pickSmartModelWithOptions(
  prompt: string,
  available: string[],
  preferred: string | undefined,
  options: { prioritizeUnrestricted: boolean; preferFreeTier: boolean },
): string {
  const list = available.filter(Boolean)
  if (list.length === 0) return preferred?.trim() || ''

  const targetComplex = isComplexPrompt(prompt)
  const lowerPreferred = preferred?.toLowerCase().trim()

  let best = list[0]
  let bestScore = Number.NEGATIVE_INFINITY

  for (const model of list) {
    const m = model.toLowerCase()
    let score = 0

    if (lowerPreferred && m === lowerPreferred) score += 8
    if (/mini|nano|flash|haiku|8b|small|instant/.test(m)) score += targetComplex ? -1 : 4
    if (/gpt-5\.4|gpt-4\.1|sonnet|opus|r1|70b|72b|pro/.test(m)) score += targetComplex ? 5 : 1
    if (options.preferFreeTier && /free|nano|mini|flash|haiku/.test(m)) score += 2
    if (options.prioritizeUnrestricted) {
      if (/llama|qwen|deepseek|mistral|r1|uncensored/.test(m)) score += 4
      if (/gpt|claude|gemini/.test(m)) score -= 1
    }

    if (score > bestScore) {
      bestScore = score
      best = model
    }
  }

  return best
}
