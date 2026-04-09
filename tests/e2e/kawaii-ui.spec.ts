import { test, expect } from '@playwright/test'

async function completeOrSkipSetup(page: Parameters<typeof test>[0]['page']) {
  const skipButton = page.getByRole('button', { name: 'Saltar y configurar manualmente después' })
  if (await skipButton.isVisible().catch(() => false)) {
    await skipButton.click()
  }
}

test.describe('KawaiiGPT UI', () => {
  test('loads main layout and opens settings', async ({ page }) => {
    await page.goto('/')
    await completeOrSkipSetup(page)

    await expect(page.getByRole('heading', { name: 'Bienvenido a KawaiiGPT' })).toBeVisible()

    await page.getByTitle('Ajustes').click()
    await expect(page.getByText('Settings ⚙️')).toBeVisible()
    await expect(page.getByPlaceholder('http://localhost:11434')).toBeVisible()
    await page.getByRole('button', { name: 'Save & Close' }).click()
    await expect(page.getByText('Settings ⚙️')).not.toBeVisible()
  })

  test('new chat button is visible and conversations panel is usable', async ({ page }) => {
    await page.goto('/')
    await completeOrSkipSetup(page)

    const newChatBtn = page.getByRole('button', { name: 'Nueva conversación' })
    await expect(newChatBtn).toBeVisible()

    // Button may be disabled if no model exists yet, but the panel must render.
    await expect(page.getByText('Sin conversaciones aún.')).toBeVisible()
  })

  test('can send a message and render it in the timeline', async ({ page }) => {
    await page.goto('/')
    await completeOrSkipSetup(page)

    const prompt = 'hola desde e2e'
    const input = page.getByPlaceholder('Escríbeme algo...')
    await input.fill(prompt)
    await input.press('Enter')

    await expect(page.getByRole('main').getByText(prompt)).toBeVisible()
  })

  test('exposes chat trace debug helpers and records a trace after send', async ({ page }) => {
    await page.goto('/')
    await completeOrSkipSetup(page)

    await page.evaluate(() => {
      ;(window as any).__kawaiiChatDebug?.clearTraces?.()
    })

    const prompt = 'prueba de trazas e2e'
    const input = page.getByPlaceholder('Escríbeme algo...')
    await input.fill(prompt)
    await input.press('Enter')

    await expect(page.getByRole('main').getByText(prompt)).toBeVisible()

    await page.waitForFunction(() => {
      const api = (window as any).__kawaiiChatDebug
      if (!api?.getRecentTraces) return false
      const traces = api.getRecentTraces(5)
      return Array.isArray(traces) && traces.length > 0 && traces[0]?.events?.length > 0
    })

    const traceSummary = await page.evaluate(() => {
      const api = (window as any).__kawaiiChatDebug
      return api.getRecentTraceSummaries(1)[0]
    })

    expect(traceSummary).toContain('trace=')
    expect(traceSummary).toContain('chat_send_start')
  })
})
