import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

function nowStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const app = await electron.launch({ args: ['.'] })
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const snapshot = await page.evaluate(async () => {
    const read = (key) => {
      try {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      } catch {
        return null
      }
    }

    const settingsRaw = read('kawaii-gpt-settings')
    const chatsRaw = read('kawaii-gpt-chats')
    const settings = settingsRaw?.state?.settings ?? null
    const chatState = chatsRaw?.state ?? null

    const chats = Array.isArray(chatState?.conversations) ? chatState.conversations : []
    const activeId = chatState?.activeId ?? null
    const active = chats.find((c) => c.id === activeId) ?? chats[0] ?? null

    const secrets = typeof window.api?.getSecret === 'function'
      ? {
          hasMainKey: Boolean(await window.api.getSecret('providerApiKey')),
          hasAp1Key: Boolean(await window.api.getSecret('ap_ap1_key')),
          hasAp2Key: Boolean(await window.api.getSecret('ap_ap2_key')),
          hasAp3Key: Boolean(await window.api.getSecret('ap_ap3_key')),
        }
      : null

    return {
      exportedAt: new Date().toISOString(),
      settings,
      chatSummary: {
        conversations: chats.length,
        activeId,
        activeTitle: active?.title ?? null,
        activeMessages: Array.isArray(active?.messages) ? active.messages.length : 0,
      },
      chats: chatState,
      secrets,
    }
  })

  const root = process.cwd()
  const outDir = join(root, 'backups')
  mkdirSync(outDir, { recursive: true })
  const outFile = join(outDir, `runtime-chat-settings-${nowStamp()}.json`)
  writeFileSync(outFile, JSON.stringify(snapshot, null, 2), 'utf8')
  console.log(`EXPORTED_FILE=${outFile}`)
} finally {
  await app.close()
}
