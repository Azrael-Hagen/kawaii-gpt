import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Conversation, Message, Role } from '@/types'

// ── ID generator ─────────────────────────────────────────────────────────────

let _seq = 0
const genId = (): string => `${Date.now()}-${++_seq}`

// ── State shape ───────────────────────────────────────────────────────────────

interface ChatState {
  conversations: Conversation[]
  activeId: string | null

  // Queries
  active: () => Conversation | undefined

  // Mutations
  create:  (model: string, title?: string) => string
  remove:  (id: string) => void
  setActive: (id: string | null) => void
  clear:   (id: string) => void
  rename:  (id: string, title: string) => void

  addMessage:    (convId: string, msg: Omit<Message, 'id'>) => string
  updateMessage: (convId: string, msgId: string, content: string, isStreaming?: boolean, imageUrl?: string, routeInfo?: string) => void
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId:      null,

      active: () => {
        const { conversations, activeId } = get()
        return conversations.find(c => c.id === activeId)
      },

      create: (model, title = 'New Chat') => {
        const id = genId()
        set(s => ({
          conversations:  [
            { id, title, model, messages: [], createdAt: Date.now(), updatedAt: Date.now() },
            ...s.conversations,
          ],
          activeId: id,
        }))
        return id
      },

      remove: (id) =>
        set(s => {
          const rest = s.conversations.filter(c => c.id !== id)
          return {
            conversations: rest,
            activeId:      s.activeId === id ? (rest[0]?.id ?? null) : s.activeId,
          }
        }),

      setActive: (id) => set({ activeId: id }),

      clear: (id) =>
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === id ? { ...c, messages: [], updatedAt: Date.now() } : c
          ),
        })),

      rename: (id, title) =>
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === id ? { ...c, title } : c
          ),
        })),

      addMessage: (convId, msg) => {
        const id = genId()
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === convId
              ? { ...c, messages: [...c.messages, { ...msg, id }], updatedAt: Date.now() }
              : c
          ),
        }))
        return id
      },

      updateMessage: (convId, msgId, content, isStreaming = false, imageUrl?, routeInfo?) =>
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map(m =>
                    m.id === msgId
                      ? {
                          ...m,
                          content,
                          isStreaming,
                          ...(imageUrl   !== undefined ? { imageUrl   } : {}),
                          ...(routeInfo  !== undefined ? { routeInfo  } : {}),
                        }
                      : m
                  ),
                  updatedAt: Date.now(),
                }
              : c
          ),
        })),
    }),
    { name: 'kawaii-gpt-chats', version: 1 }
  )
)

// ── Helpers re-exported for convenience ──────────────────────────────────────

export const buildRole = (role: Role): Role => role
