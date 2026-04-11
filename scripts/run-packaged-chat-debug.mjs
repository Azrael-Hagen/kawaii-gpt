import { _electron as electron } from 'playwright'
import { join } from 'node:path'

const PROMPT = process.argv.slice(2).join(' ').trim() || 'Responde solo con OK para prueba de conectividad en packaged.'
const WAIT_TIMEOUT_MS = 60000

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function readRuntimeState(page) {
  return page.evaluate(async () => {
    const runtimeMode = typeof window.api?.getRuntimeMode === 'function'
      ? await window.api.getRuntimeMode().catch(() => 'unknown')
      : 'unknown'

    const rawSettings = localStorage.getItem('kawaii-gpt-settings')
    const rawChats = localStorage.getItem('kawaii-gpt-chats')
    const parsedSettings = rawSettings ? JSON.parse(rawSettings) : null
    const parsedChats = rawChats ? JSON.parse(rawChats) : null
    const settings = parsedSettings?.state?.settings ?? null
    const chats = parsedChats?.state?.conversations ?? []
    const activeId = parsedChats?.state?.activeId ?? null
    const active = chats.find(item => item.id === activeId) ?? chats[0] ?? null
    const messages = active?.messages ?? []
    const latestMessages = messages.slice(-4).map(msg => ({
      role: msg.role,
      content: msg.content,
      isStreaming: !!msg.isStreaming,
      routeInfo: msg.routeInfo ?? null,
      timestamp: msg.timestamp,
    }))

    return {
      runtime: {
        mode: runtimeMode,
        url: location.href,
        origin: location.origin,
      },
      settings: settings
        ? {
            provider: settings.provider,
            defaultModel: settings.defaultModel,
            localModel: settings.localModel,
            cloudModel: settings.cloudModel,
            localBaseUrl: settings.localBaseUrl,
            cloudBaseUrl: settings.cloudBaseUrl,
            autoFailover: settings.autoFailover,
            streamResponses: settings.streamResponses,
          }
        : null,
      latestMessages,
    }
  })
}

async function waitForChatToSettle(page) {
  const start = Date.now()
  while (Date.now() - start < WAIT_TIMEOUT_MS) {
    const state = await readRuntimeState(page)
    const latestAssistant = [...state.latestMessages].reverse().find(msg => msg.role === 'assistant')
    if (latestAssistant && !latestAssistant.isStreaming && latestAssistant.content?.trim()) {
      return { done: true, reason: 'assistant-finished', state }
    }
    await sleep(1200)
  }
  return { done: false, reason: 'timeout', state: await readRuntimeState(page) }
}

const executablePath = join(process.cwd(), 'dist', 'win-unpacked', 'KawaiiGPT.exe')

const app = await electron.launch({ executablePath })
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const input = page.getByPlaceholder('Escríbeme algo...')
  await input.fill(PROMPT)
  await input.press('Enter')

  const result = await waitForChatToSettle(page)

  const summary = {
    prompt: PROMPT,
    settled: result.done,
    reason: result.reason,
    runtime: result.state.runtime,
    settings: result.state.settings,
    latestMessages: result.state.latestMessages,
  }

  console.log(JSON.stringify(summary, null, 2))
} finally {
  await app.close()
}
