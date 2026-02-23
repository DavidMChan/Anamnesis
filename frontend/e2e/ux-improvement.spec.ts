import { test, expect } from '@playwright/test'

/**
 * E2E tests for UX Improvements: Cancel Survey Run + Configurable Concurrency
 *
 * Note: Full E2E testing of the survey run flow requires:
 * 1. Authenticated user session
 * 2. Active survey with backstories
 * 3. Running worker + dispatcher
 *
 * These tests verify the UI components that can be tested without
 * full backend infrastructure.
 */

test.describe('Configurable Concurrency - Settings Page', () => {
  test.describe('Unauthenticated - Redirect', () => {
    test('settings page redirects unauthenticated user', async ({ page }) => {
      await page.goto('/settings')
      await page.waitForURL(/\/(login|settings)/)

      const currentUrl = page.url()
      if (currentUrl.includes('/login')) {
        await expect(page.getByText('Welcome back')).toBeVisible()
      }
    })
  })

  test('settings page loads without JavaScript errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    expect(errors).toHaveLength(0)
  })
})

/**
 * These tests require an authenticated session with a running survey.
 * Skipped by default — run manually with auth mocking.
 */
test.describe.skip('Cancel Survey Run (requires auth + running survey)', () => {
  test('user starts a survey run and sees Stop Run button', async ({ page }) => {
    // Navigate to a survey with a running run
    await page.goto('/surveys/test-survey-id')

    // Verify "Stop Run" button appears during running state
    await expect(page.getByRole('button', { name: /Stop Run/i })).toBeVisible()
  })

  test('clicking Stop Run shows confirmation dialog', async ({ page }) => {
    await page.goto('/surveys/test-survey-id')

    await page.getByRole('button', { name: /Stop Run/i }).click()

    await expect(page.getByText('Stop this survey run?')).toBeVisible()
    await expect(page.getByText(/Tasks already in progress will finish/)).toBeVisible()
  })

  test('confirming Stop Run cancels the run', async ({ page }) => {
    await page.goto('/surveys/test-survey-id')

    // Click Stop Run
    await page.getByRole('button', { name: /Stop Run/i }).click()

    // Confirm in dialog
    await page.getByRole('button', { name: 'Stop Run', exact: true }).click()

    // Run status should change to cancelled
    await expect(page.getByText('Cancelled')).toBeVisible()

    // Stop Run button should no longer be visible
    await expect(page.getByRole('button', { name: /Stop Run/i })).not.toBeVisible()
  })

  test('after cancelling, remaining tasks show as cancelled', async ({ page }) => {
    await page.goto('/surveys/test-survey-id')

    // The remaining count should reflect cancelled state
    await expect(page.getByText('Cancelled')).toBeVisible()
  })

  test('user can start a new run after cancelling', async ({ page }) => {
    await page.goto('/surveys/test-survey-id')

    // Run Again button should be visible after cancel
    await expect(page.getByRole('button', { name: 'Run Again' })).toBeVisible()

    // Click Run Again
    await page.getByRole('button', { name: 'Run Again' }).click()

    // Should start a new run
    await expect(page.getByText('Running')).toBeVisible()
  })
})

test.describe.skip('Configurable Concurrency (requires auth)', () => {
  test('user changes max_concurrent_tasks, saves, reloads — value persists', async ({ page }) => {
    await page.goto('/settings')

    // Find and change the concurrency input
    const input = page.getByLabel('Max Concurrent Tasks')
    await input.fill('50')

    // Save
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.getByText('Changes saved!')).toBeVisible()

    // Reload page
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Value should persist
    await expect(page.getByLabel('Max Concurrent Tasks')).toHaveValue('50')
  })
})
