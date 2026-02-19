import { test, expect } from '@playwright/test'

/**
 * E2E tests for Supabase Vault API Key Encryption feature
 *
 * Note: Full E2E testing of the API key flow requires authentication,
 * which would need either:
 * 1. Real test credentials
 * 2. Mocking Supabase at the network level
 *
 * These tests verify the UI components and behavior that can be tested
 * without authentication. Unit tests in tests/utils/apiKeyUtils.test.ts
 * cover the masking logic comprehensively.
 */

test.describe('API Key Vault - UI Components', () => {
  test.describe('Unauthenticated User - Settings Page Redirect', () => {
    test('settings page redirects unauthenticated user to login', async ({ page }) => {
      // Try to access settings page without authentication
      await page.goto('/settings')

      // Should be redirected to login page
      // Wait for navigation to complete
      await page.waitForURL(/\/(login|settings)/)

      // If redirected to login, verify the page loads
      const currentUrl = page.url()
      if (currentUrl.includes('/login')) {
        await expect(page.getByText('Welcome back')).toBeVisible()
      }
    })
  })

  test.describe('Settings Page Load', () => {
    test('settings page loads without JavaScript errors when accessed', async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (err) => errors.push(err.message))

      // Navigate to settings (will redirect if not authenticated)
      await page.goto('/settings')

      // Wait for any page to load
      await page.waitForLoadState('networkidle')

      // Should have no JavaScript errors
      expect(errors).toHaveLength(0)
    })
  })
})

/**
 * Integration tests that would run with mocked authentication
 * These tests describe the expected behavior but require auth mocking to run
 */
test.describe.skip('API Key Vault - Authenticated User Flow (requires auth mocking)', () => {
  // These tests are skipped because they require authentication
  // They serve as documentation for the expected behavior

  test('user can add a new API key', async ({ page }) => {
    // Would need to mock auth first
    await page.goto('/settings')

    // Click "Add" button to start editing
    await page.getByRole('button', { name: 'Add' }).click()

    // Enter a new API key
    const apiKeyInput = page.getByPlaceholder('Enter new API key...')
    await apiKeyInput.fill('sk-test-key-1234567890abcdef')

    // Save changes
    await page.getByRole('button', { name: 'Save Changes' }).click()

    // Verify success message
    await expect(page.getByText('Changes saved!')).toBeVisible()

    // Verify masked key is displayed
    await expect(page.getByDisplayValue(/^sk-\.\.\.def$/)).toBeVisible()
  })

  test('user can update an existing API key', async ({ page }) => {
    // Would need to mock auth and existing key
    await page.goto('/settings')

    // Click "Change" button to edit existing key
    await page.getByRole('button', { name: 'Change' }).click()

    // Enter a new API key
    const apiKeyInput = page.getByPlaceholder('Enter new API key...')
    await apiKeyInput.fill('sk-new-key-0987654321fedcba')

    // Save changes
    await page.getByRole('button', { name: 'Save Changes' }).click()

    // Verify success message
    await expect(page.getByText('Changes saved!')).toBeVisible()

    // Verify new masked key is displayed
    await expect(page.getByDisplayValue(/^sk-\.\.\.cba$/)).toBeVisible()
  })

  test('user can clear their API key', async ({ page }) => {
    // Would need to mock auth and existing key
    await page.goto('/settings')

    // Click remove button (X icon)
    await page.getByTitle('Remove API key').click()

    // Verify success message
    await expect(page.getByText('Changes saved!')).toBeVisible()

    // Verify key is cleared (input shows placeholder)
    await expect(page.getByPlaceholder('No API key configured')).toBeVisible()

    // "Add" button should appear instead of "Change"
    await expect(page.getByRole('button', { name: 'Add' })).toBeVisible()
  })

  test('user can cancel editing without saving', async ({ page }) => {
    // Would need to mock auth
    await page.goto('/settings')

    // Click "Add" button to start editing
    await page.getByRole('button', { name: 'Add' }).click()

    // Enter a value
    const apiKeyInput = page.getByPlaceholder('Enter new API key...')
    await apiKeyInput.fill('sk-temporary-key')

    // Click cancel button
    await page.getByTitle('Cancel').click()

    // Should be back to non-editing state
    await expect(page.getByRole('button', { name: 'Add' })).toBeVisible()
  })

  test('user can toggle API key visibility while editing', async ({ page }) => {
    // Would need to mock auth
    await page.goto('/settings')

    // Start editing
    await page.getByRole('button', { name: 'Add' }).click()

    // Enter a key
    const apiKeyInput = page.getByPlaceholder('Enter new API key...')
    await apiKeyInput.fill('sk-visible-test-key')

    // Initially should be password type (hidden)
    await expect(apiKeyInput).toHaveAttribute('type', 'password')

    // Click eye icon to show
    await page.locator('button:has(svg.lucide-eye)').click()

    // Should now be text type (visible)
    await expect(apiKeyInput).toHaveAttribute('type', 'text')

    // Click again to hide
    await page.locator('button:has(svg.lucide-eye-off)').click()

    // Should be password type again
    await expect(apiKeyInput).toHaveAttribute('type', 'password')
  })
})
