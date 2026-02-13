import { test, expect } from '@playwright/test'

/**
 * E2E tests for Auth Redirect Guard
 *
 * Note: Testing the authenticated user redirect behavior requires either:
 * 1. Real test credentials and logging in
 * 2. Mocking Supabase at the network level
 *
 * For now, we focus on testing unauthenticated user behavior and
 * verifying the pages load correctly without errors.
 *
 * The unit tests (Login.test.tsx, Register.test.tsx, Home.test.tsx)
 * provide comprehensive coverage of the redirect logic by mocking
 * the AuthContext directly.
 */

test.describe('Auth Redirect Guard - Unauthenticated User', () => {
  test('can access home page normally', async ({ page }) => {
    await page.goto('/')

    // Should see the home page content
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Use more specific locator to avoid matching footer text
    await expect(page.locator('nav').getByText('Anamnesis')).toBeVisible()
  })

  test('can access login page normally', async ({ page }) => {
    await page.goto('/login')

    // Should see the login form
    await expect(page.getByText('Welcome back')).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
  })

  test('can access register page normally', async ({ page }) => {
    await page.goto('/register')

    // Should see the register form
    await expect(page.getByText('Create an account')).toBeVisible()
    await expect(page.getByLabel('Name')).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
  })

  test('can navigate from home to login', async ({ page }) => {
    await page.goto('/')

    // Click sign in button (use the one in the nav, not hero)
    await page.locator('nav').getByRole('link', { name: /sign in/i }).click()

    // Should be on login page
    await expect(page).toHaveURL('/login')
    await expect(page.getByText('Welcome back')).toBeVisible()
  })

  test('can navigate from home to register', async ({ page }) => {
    await page.goto('/')

    // Click get started button (use the one in the nav)
    await page.locator('nav').getByRole('link', { name: /get started/i }).click()

    // Should be on register page
    await expect(page).toHaveURL('/register')
    await expect(page.getByText('Create an account')).toBeVisible()
  })

  test('can navigate from login to register', async ({ page }) => {
    await page.goto('/login')

    // Click create account link
    await page.getByRole('link', { name: /create one/i }).click()

    // Should be on register page
    await expect(page).toHaveURL('/register')
    await expect(page.getByText('Create an account')).toBeVisible()
  })

  test('can navigate from register to login', async ({ page }) => {
    await page.goto('/register')

    // Click sign in link
    await page.getByRole('link', { name: /sign in/i }).click()

    // Should be on login page
    await expect(page).toHaveURL('/login')
    await expect(page.getByText('Welcome back')).toBeVisible()
  })
})

test.describe('Auth Redirect Guard - Page Load Behavior', () => {
  test('login page loads without JavaScript errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/login')
    await expect(page.getByText('Welcome back')).toBeVisible()

    expect(errors).toHaveLength(0)
  })

  test('register page loads without JavaScript errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/register')
    await expect(page.getByText('Create an account')).toBeVisible()

    expect(errors).toHaveLength(0)
  })

  test('home page loads without JavaScript errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    expect(errors).toHaveLength(0)
  })
})
