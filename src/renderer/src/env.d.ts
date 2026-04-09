/// <reference types="vite/client" />

interface Window {
  api: {
    minimize: () => void
    maximize: () => void
    close: () => void
    getVersion: () => Promise<string>
    getRuntimeMode: () => Promise<'dev' | 'packaged'>
    getSecret?: (key: string) => Promise<string>
    setSecret?: (key: string, value: string) => Promise<void>
    webSearch?: (query: string, maxResults?: number) => Promise<Array<{ title: string; snippet: string; url: string }>>
    openExternal?: (url: string) => Promise<void>
    legacyStatus?: () => Promise<{ running: boolean; pid?: number; command?: string; lastError?: string }>
    legacyStart?: (payload?: { command?: string; args?: string; cwd?: string }) => Promise<{ running: boolean; pid?: number; command?: string; lastError?: string }>
    legacyStop?: () => Promise<{ running: boolean; pid?: number; command?: string; lastError?: string }>
  }
}
