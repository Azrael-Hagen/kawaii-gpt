import type { AIModel, LocalModelCapacityMode } from '@/types'

export type SystemHardwareProfile = {
  totalMemoryGB: number
  cpuCores: number
  architecture: string
}

function normalize(value: string): string {
  return value.toLowerCase().trim()
}

function extractModelSizeB(model: AIModel): number | null {
  if (typeof model.size === 'number' && Number.isFinite(model.size) && model.size > 0) {
    return model.size / (1024 ** 3)
  }

  const lower = normalize(model.name)
  const sizeMatch = lower.match(/(\d+(?:\.\d+)?)\s*b\b/)
  if (!sizeMatch?.[1]) return null

  const parsed = Number(sizeMatch[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function getRecommendedMinimumLocalModelSizeB(
  profile: SystemHardwareProfile | null,
  mode: LocalModelCapacityMode = 'auto',
): number {
  if (!profile || !Number.isFinite(profile.totalMemoryGB)) return 0
  if (mode === 'off') return 0

  const ram = profile.totalMemoryGB
  let floor = 0

  if (mode === 'conservative') {
    if (ram >= 64) floor = 12
    else if (ram >= 48) floor = 8
    else if (ram >= 32) floor = 7
    else if (ram >= 24) floor = 4
    else if (ram >= 16) floor = 3
  } else if (mode === 'aggressive') {
    if (ram >= 64) floor = 20
    else if (ram >= 48) floor = 14
    else if (ram >= 32) floor = 12
    else if (ram >= 24) floor = 8
    else if (ram >= 16) floor = 7
    else if (ram >= 12) floor = 4
  } else {
    if (ram >= 64) floor = 14
    else if (ram >= 48) floor = 12
    else if (ram >= 32) floor = 8
    else if (ram >= 24) floor = 7
    else if (ram >= 16) floor = 4
    else if (ram >= 12) floor = 3
  }

  if (profile.cpuCores <= 4) {
    floor = Math.min(floor, 4)
  }

  return floor
}

export function filterLocalModelsByHardwareCapacity(
  models: AIModel[],
  profile: SystemHardwareProfile | null,
  mode: LocalModelCapacityMode = 'auto',
): AIModel[] {
  const floor = getRecommendedMinimumLocalModelSizeB(profile, mode)
  if (floor <= 0) return models

  const candidates = models.filter(model => model.provider === 'ollama' && isCompatibleLocalChatModel(model.name))
  if (candidates.length === 0) return models

  const filtered = candidates.filter(model => {
    const sizeB = extractModelSizeB(model)
    if (sizeB == null) return true
    return sizeB >= floor
  })

  // Keep compatibility in constrained environments where only small models are available.
  return filtered.length > 0 ? filtered : candidates
}

export function isCompatibleLocalChatModel(name: string): boolean {
  const lower = normalize(name)
  if (!lower) return false

  if (/embed|embedding|nomic-embed|bge-|mxbai-embed|all-minilm|snowflake-arctic-embed|e5-/.test(lower)) {
    return false
  }

  if (/guard|moderation|safeguard|ocr/.test(lower)) {
    return false
  }

  return true
}

export function scoreLocalModelIntelligence(name: string): number {
  const lower = normalize(name)
  if (!isCompatibleLocalChatModel(lower)) return Number.NEGATIVE_INFINITY

  let score = 0

  const sizeMatch = lower.match(/(\d+(?:\.\d+)?)\s*b\b/)
  const sizeB = sizeMatch?.[1] ? Number(sizeMatch[1]) : 0
  if (Number.isFinite(sizeB) && sizeB > 0) {
    score += Math.min(150, sizeB * 3)
  }

  if (/thinking|reason|r1|r2|qwq|deepseek-r1|phi4-reasoning/.test(lower)) score += 45
  if (/qwen3|qwen2\.5|llama3\.3|llama3\.1|mistral-large|command-r\+|gemma4|mixtral|70b|72b|120b|123b/.test(lower)) score += 30
  if (/coder|codestral|devstral/.test(lower)) score += 8

  if (/0\.5b|1b|1\.5b|2b|3b|3\.8b/.test(lower)) score -= 35
  if (/tiny|mini(?!stral)|small(?!3\.2)|flash/.test(lower)) score -= 12

  return score
}

export function pickMostIntelligentLocalModel(models: AIModel[]): AIModel | null {
  const candidates = models.filter(model => model.provider === 'ollama' && isCompatibleLocalChatModel(model.name))
  if (candidates.length === 0) return null

  let best = candidates[0]
  let bestScore = scoreLocalModelIntelligence(best.name)

  for (const model of candidates.slice(1)) {
    const score = scoreLocalModelIntelligence(model.name)
    if (score > bestScore) {
      best = model
      bestScore = score
    }
  }

  return best
}
