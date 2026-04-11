import type { Conversation, Message, Role, UserMemoryFact } from '@/types'

export type ConversationImportMode = 'merge' | 'replace'

export interface ConversationExportPayload {
  schema: 'kawaii-gpt-conversations'
  version: 1
  exportedAt: string
  chats: {
    conversations: Conversation[]
    activeId: string | null
  }
}

export interface ParsedConversationImport {
  conversations: Conversation[]
  activeId: string | null
}

const SAFE_ROLES: Role[] = ['user', 'assistant', 'system']

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return fallback
}

function asRole(value: unknown, fallback: Role = 'user'): Role {
  return SAFE_ROLES.includes(value as Role) ? (value as Role) : fallback
}

function normalizeMessage(raw: unknown, index: number): Message {
  const obj = asObject(raw) ?? {}
  const fallbackId = `import-msg-${Date.now()}-${index}`
  const timestamp = asNumber(obj.timestamp, Date.now())
  return {
    id: asString(obj.id, fallbackId),
    role: asRole(obj.role, 'user'),
    content: asString(obj.content, ''),
    timestamp,
    isStreaming: false,   // Always false on import — previous-session streaming state is stale
    routeInfo: asString(obj.routeInfo, undefined as unknown as string),
    imageUrl: asString(obj.imageUrl, undefined as unknown as string),
    attachments: Array.isArray(obj.attachments) ? (obj.attachments as Message['attachments']) : undefined,
  }
}

function normalizeUserMemory(raw: unknown, index: number): UserMemoryFact {
  const obj = asObject(raw) ?? {}
  return {
    id: asString(obj.id, `import-memory-${Date.now()}-${index}`),
    key: asString(obj.key, `dato-${index + 1}`),
    value: asString(obj.value, ''),
    sourceMessageId: asString(obj.sourceMessageId, ''),
    updatedAt: asNumber(obj.updatedAt, Date.now()),
  }
}

function normalizeConversation(raw: unknown, index: number): Conversation | null {
  const obj = asObject(raw)
  if (!obj) return null

  const messages = asArray(obj.messages)
    .map((item, msgIndex) => normalizeMessage(item, msgIndex))
    // Drop empty assistant turns that were ghost-placeholder from crashed sessions
    .filter((m, idx, arr) => {
      if (m.role !== 'assistant') return true
      if ((m.content ?? '').trim() !== '') return true
      // Keep non-empty assistant turns, drop empty ones only at the tail
      return idx < arr.length - 1
    })
  const createdAt = asNumber(obj.createdAt, Date.now())
  const updatedAt = asNumber(obj.updatedAt, createdAt)

  return {
    id: asString(obj.id, `import-conv-${Date.now()}-${index}`),
    title: asString(obj.title, 'Conversacion importada'),
    model: asString(obj.model, ''),
    messages,
    userMemory: asArray(obj.userMemory).map((item, memoryIndex) => normalizeUserMemory(item, memoryIndex)),
    createdAt,
    updatedAt,
    systemPrompt: asString(obj.systemPrompt, undefined as unknown as string),
  }
}

export function buildConversationExportPayload(
  conversations: Conversation[],
  activeId: string | null,
): ConversationExportPayload {
  return {
    schema: 'kawaii-gpt-conversations',
    version: 1,
    exportedAt: new Date().toISOString(),
    chats: {
      conversations,
      activeId,
    },
  }
}

export function parseConversationImportPayload(raw: unknown): ParsedConversationImport {
  const root = asObject(raw)
  if (!root) {
    return { conversations: [], activeId: null }
  }

  const stateCandidate = asObject(root.state)
  const chatsCandidate = asObject(root.chats)

  const conversationsRaw =
    asArray(root.conversations).length > 0
      ? asArray(root.conversations)
      : asArray(stateCandidate?.conversations).length > 0
        ? asArray(stateCandidate?.conversations)
        : asArray(chatsCandidate?.conversations)

  const conversations = conversationsRaw
    .map((item, index) => normalizeConversation(item, index))
    .filter((item): item is Conversation => Boolean(item))

  const activeId =
    asString(root.activeId, '') ||
    asString(stateCandidate?.activeId, '') ||
    asString(chatsCandidate?.activeId, '') ||
    null

  return {
    conversations,
    activeId,
  }
}