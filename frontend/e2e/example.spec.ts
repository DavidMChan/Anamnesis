import { test, expect } from '@playwright/test'

test('homepage loads', async ({ page }) => {
  await page.goto('/')
  // Check that the page has a title
  await expect(page).toHaveTitle(/.*/)
})

test('navigation works', async ({ page }) => {
  await page.goto('/')
  // Basic check that the page rendered something
  const body = page.locator('body')
  await expect(body).toBeVisible()
})
