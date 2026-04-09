const AVG_CHARS_PER_TOKEN = 3.8

export function estimateTokensFromChars(charCount: number): number {
  const safeChars = Math.max(0, charCount)
  if (safeChars === 0) return 0
  return Math.max(1, Math.ceil(safeChars / AVG_CHARS_PER_TOKEN))
}

export function computeCompletionCapFromPromptChars(promptChars: number, fallbackMax: number): number {
  const safeFallback = Math.max(120, fallbackMax)

  if (promptChars <= 80) return Math.min(safeFallback, 220)
  if (promptChars <= 180) return Math.min(safeFallback, 320)
  if (promptChars <= 360) return Math.min(safeFallback, 480)
  if (promptChars <= 700) return Math.min(safeFallback, 700)

  return safeFallback
}
