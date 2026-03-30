import type { ChatMessageInput, UserMemoryFact } from '@/types'

interface CandidateMemoryFact {
  key: string
  value: string
}

function normalizeMemoryValue(raw: string): string {
  return raw.replace(/[\s.!,;:]+$/g, '').trim()
}

export function extractImportantUserFacts(content: string): CandidateMemoryFact[] {
  const text = content.trim()
  if (!text) return []

  const patterns: Array<{ key: string; regex: RegExp }> = [
    { key: 'name', regex: /(?:me llamo|mi nombre es)\s+([a-zA-Z\u00C0-\u017F'\- ]{2,40})/i },
    { key: 'age', regex: /tengo\s+(\d{1,3})\s+años/i },
    { key: 'location', regex: /(?:soy de|vivo en)\s+([a-zA-Z\u00C0-\u017F'\- ]{2,50})/i },
    { key: 'occupation', regex: /(?:trabajo como|soy)\s+(desarrollador|programador|diseñador|estudiante|ingeniero|docente|medico|médico)/i },
    { key: 'likes', regex: /(?:me gusta|me encantan|me encanta)\s+([a-zA-Z\u00C0-\u017F'\-, ]{2,80})/i },
    { key: 'dislikes', regex: /(?:no me gusta|detesto|odio)\s+([a-zA-Z\u00C0-\u017F'\-, ]{2,80})/i },
    { key: 'hobby', regex: /(?:mi hobby favorito es|mis hobbies son|me gusta hacer)\s+([a-zA-Z\u00C0-\u017F'\-, ]{2,80})/i },
    { key: 'personality_trait', regex: /(?:soy|me considero)\s+(introvertido|extrovertido|curioso|romántico|romantico|tranquilo|sensible|analítico|analitico|creativo|tímido|timido)/i },
    { key: 'communication_style', regex: /(?:prefiero que me hables|háblame|hablame)\s+(?:de forma|con un tono)?\s*([a-zA-Z\u00C0-\u017F'\-, ]{2,80})/i },
    { key: 'favorite_food', regex: /mi comida favorita es\s+([a-zA-Z\u00C0-\u017F'\- ]{2,50})/i },
    { key: 'favorite_color', regex: /mi color favorito es\s+([a-zA-Z\u00C0-\u017F'\- ]{2,30})/i },
  ]

  const facts = patterns
    .map(({ key, regex }) => {
      const match = text.match(regex)
      if (!match?.[1]) return null
      const value = normalizeMemoryValue(match[1])
      if (!value) return null
      return { key, value }
    })
    .filter((fact): fact is CandidateMemoryFact => Boolean(fact))

  return facts
}

export function prependUserMemoryContext(
  messages: ChatMessageInput[],
  memoryFacts: UserMemoryFact[],
): ChatMessageInput[] {
  if (memoryFacts.length === 0) return messages

  const memoryLines = memoryFacts
    .map(fact => `- ${fact.key}: ${fact.value}`)
    .join('\n')

  const contextMessage: ChatMessageInput = {
    role: 'user',
    content: [
      'Memoria local del usuario (solo para esta conversación):',
      memoryLines,
      'Usa estos datos para personalizar, sin inventar atributos no declarados.',
    ].join('\n'),
  }

  return [contextMessage, ...messages]
}
