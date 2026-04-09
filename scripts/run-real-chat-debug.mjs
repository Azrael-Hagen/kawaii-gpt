import { _electron as electron } from 'playwright'

const PROMPT = process.argv.slice(2).join(' ').trim() || 'Responde solo con OK para prueba de conectividad.'
const WAIT_TIMEOUT_MS = 45000

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

    const secrets = typeof window.api?.getSecret === 'function'
      ? {
          hasMainKey: Boolean(await window.api.getSecret('providerApiKey')),
          hasAp1Key: Boolean(await window.api.getSecret('ap_ap1_key')),
          hasAp2Key: Boolean(await window.api.getSecret('ap_ap2_key')),
          hasAp3Key: Boolean(await window.api.getSecret('ap_ap3_key')),
        }
      : null

    const debugApi = window.__kawaiiChatDebug
    const traces = debugApi?.getRecentTraces?.(5) ?? []
    const traceSummaries = debugApi?.getRecentTraceSummaries?.(3) ?? []

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
            cloudDiagnostics: settings.cloudDiagnostics,
            lastErrorReport: settings.lastErrorReport,
            errorLogs: (settings.errorLogs ?? []).slice(0, 6),
            cloudConnectivity: (settings.cloudConnectivity ?? []).slice(0, 6),
            additionalProviders: (settings.additionalProviders ?? []).map(item => ({
              id: item.id,
              name: item.name,
              baseUrl: item.baseUrl,
              enabled: item.enabled,
            })),
          }
        : null,
      secrets,
      latestMessages,
      traceCount: traces.length,
      traceSummaries,
    }
  })
}

async function completeOrSkipSetup(page) {
  const skipButton = page.getByRole('button', { name: 'Saltar y configurar manualmente después' })
  if (await skipButton.isVisible().catch(() => false)) {
    await skipButton.click()
  }
}

async function waitForChatToSettle(page) {
  const start = Date.now()
  while (Date.now() - start < WAIT_TIMEOUT_MS) {
    const state = await readRuntimeState(page)
    const latestAssistant = [...state.latestMessages].reverse().find(msg => msg.role === 'assistant')
    const lastError = state.settings?.errorLogs?.[0]
    if (latestAssistant && !latestAssistant.isStreaming && latestAssistant.content?.trim()) {
      return { done: true, reason: 'assistant-finished', state }
    }
    if (lastError && Date.now() - (lastError.at ?? 0) < WAIT_TIMEOUT_MS) {
      await sleep(1500)
      const refreshed = await readRuntimeState(page)
      return { done: true, reason: 'error-log-recorded', state: refreshed }
    }
    await sleep(1200)
  }
  return { done: false, reason: 'timeout', state: await readRuntimeState(page) }
}

const app = await electron.launch({ args: ['.'] })
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await completeOrSkipSetup(page)

  await page.evaluate(() => {
    window.__kawaiiChatDebug?.clearTraces?.()
  })

  const input = page.getByPlaceholder('Escríbeme algo...')
  await input.fill(PROMPT)
  await input.press('Enter')

  const result = await waitForChatToSettle(page)
  const state = result.state

  const summary = {
    prompt: PROMPT,
    settled: result.done,
    reason: result.reason,
    runtime: state.runtime,
    settings: state.settings,
    secrets: state.secrets,
    latestMessages: state.latestMessages,
    traceCount: state.traceCount,
    traceSummaries: state.traceSummaries,
  }

  console.log(JSON.stringify(summary, null, 2))
} finally {
  await app.close()
}
