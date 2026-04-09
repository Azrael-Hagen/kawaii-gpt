import { computeCompletionCapFromPromptChars, estimateTokensFromChars } from '@/services/tokenBudget'

export interface ChatRequestBudgetInput {
  baseMaxTokens: number
  promptChars: number
  contextChars: number
  providerLatencyMs: number
  networkRttMs: number
}

export interface ChatRequestBudget {
  promptTokens: number
  contextTokens: number
  maxTokens: number
}

export function computeChatRequestBudget(input: ChatRequestBudgetInput): ChatRequestBudget {
  const promptTokens = estimateTokensFromChars(input.promptChars)
  const contextTokens = estimateTokensFromChars(input.contextChars)

  let maxTokens = Math.max(120, input.baseMaxTokens)
  maxTokens = Math.min(maxTokens, computeCompletionCapFromPromptChars(input.promptChars, maxTokens))

  if (input.contextChars >= 12_000) maxTokens = Math.min(maxTokens, 700)
  if (input.contextChars >= 20_000) maxTokens = Math.min(maxTokens, 520)
  if (input.contextChars >= 28_000) maxTokens = Math.min(maxTokens, 360)

  if (contextTokens >= 2_500) maxTokens = Math.min(maxTokens, 420)
  if (contextTokens >= 4_000) maxTokens = Math.min(maxTokens, 320)

  if (input.providerLatencyMs >= 1_200) maxTokens = Math.min(maxTokens, 560)
  if (input.providerLatencyMs >= 2_000) maxTokens = Math.min(maxTokens, 420)

  if (input.networkRttMs >= 700) maxTokens = Math.min(maxTokens, 560)
  if (input.networkRttMs >= 1_200) maxTokens = Math.min(maxTokens, 420)

  return {
    promptTokens,
    contextTokens,
    maxTokens: Math.max(120, maxTokens),
  }
}
