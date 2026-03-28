import { test, expect } from '@playwright/test'

test.describe('KawaiiGPT UI', () => {
  test('loads main layout and opens settings', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Welcome to KawaiiGPT' })).toBeVisible()

    await page.getByTitle('Settings').click()
    await expect(page.getByText('Settings ⚙️')).toBeVisible()
    await expect(page.getByPlaceholder('http://localhost:11434')).toBeVisible()
    await page.getByRole('button', { name: 'Save & Close' }).click()
    await expect(page.getByText('Settings ⚙️')).not.toBeVisible()
  })

  test('new chat button is visible and conversations panel is usable', async ({ page }) => {
    await page.goto('/')

    const newChatBtn = page.getByRole('button', { name: 'New Chat' })
    await expect(newChatBtn).toBeVisible()

    // Button may be disabled if no model exists yet, but the panel must render.
    await expect(page.getByText('No conversations yet.')).toBeVisible()
  })
})
