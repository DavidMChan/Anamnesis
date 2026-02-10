import { test, expect } from '@playwright/test'

/**
 * E2E tests for Google Login Support
 *
 * Note: We can only test that the button is present and clickable.
 * Actual OAuth flow requires real credentials and Google's consent screen.
 */

test.describe('Google Login Support', () => {
  test('login page displays Google button', async ({ page }) => {
    await page.goto('/login')

    const googleButton = page.getByRole('button', { name: /continue with google/i })
    await expect(googleButton).toBeVisible()
  })

  test('register page displays Google button', async ({ page }) => {
    await page.goto('/register')

    const googleButton = page.getByRole('button', { name: /continue with google/i })
    await expect(googleButton).toBeVisible()
  })

  test('Google button is visible and clickable on login page', async ({ page }) => {
    await page.goto('/login')

    const googleButton = page.getByRole('button', { name: /continue with google/i })
    await expect(googleButton).toBeVisible()
    await expect(googleButton).toBeEnabled()
  })

  test('Google button is visible and clickable on register page', async ({ page }) => {
    await page.goto('/register')

    const googleButton = page.getByRole('button', { name: /continue with google/i })
    await expect(googleButton).toBeVisible()
    await expect(googleButton).toBeEnabled()
  })

  test('login page shows "or" divider between Google button and email form', async ({ page }) => {
    await page.goto('/login')

    await expect(page.getByText('or', { exact: true })).toBeVisible()
  })

  test('register page shows "or" divider between Google button and email form', async ({ page }) => {
    await page.goto('/register')

    await expect(page.getByText('or', { exact: true })).toBeVisible()
  })

  test('login page loads without JavaScript errors after adding Google button', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/login')
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible()

    expect(errors).toHaveLength(0)
  })

  test('register page loads without JavaScript errors after adding Google button', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/register')
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible()

    expect(errors).toHaveLength(0)
  })
})
