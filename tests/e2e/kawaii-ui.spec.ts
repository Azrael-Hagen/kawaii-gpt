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
})
