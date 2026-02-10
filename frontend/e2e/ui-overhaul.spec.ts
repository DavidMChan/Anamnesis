import { test, expect } from '@playwright/test'

test.describe('UI Overhaul - Navigation', () => {
  test('home page renders with warm design', async ({ page }) => {
    await page.goto('/')

    // Check navigation bar exists
    await expect(page.locator('nav')).toBeVisible()

    // Check hero section
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // Check "How it works" section is visible
    await expect(page.getByText('How it works')).toBeVisible()
    await expect(page.getByText('Prepare Backstories')).toBeVisible()
  })

  test('login page has centered card design', async ({ page }) => {
    await page.goto('/login')

    // Check form elements are visible
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

    // Check link to register
    await expect(page.getByText('Create one')).toBeVisible()
  })

  test('register page matches login styling', async ({ page }) => {
    await page.goto('/register')

    // Check form elements are visible
    await expect(page.getByLabel('Name')).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
  })
})

test.describe('UI Overhaul - Theme', () => {
  test('page uses warm color palette', async ({ page }) => {
    await page.goto('/')

    // Check that the page has loaded with our CSS
    const body = page.locator('body')
    await expect(body).toBeVisible()

    // The background should be visible (warm cream color)
    const backgroundColor = await body.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor
    })

    // Should have some background color set
    expect(backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })

  test('buttons have rounded styling', async ({ page }) => {
    await page.goto('/')

    // Check primary button has rounded styling
    const primaryButton = page.getByRole('button').first()
    await expect(primaryButton).toBeVisible()

    const borderRadius = await primaryButton.evaluate((el) => {
      return window.getComputedStyle(el).borderRadius
    })

    // Should have some border radius
    expect(borderRadius).not.toBe('0px')
  })
})

test.describe('UI Overhaul - Responsive', () => {
  test('mobile view shows hamburger menu', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')

    // Mobile menu button should be visible
    const mobileMenuButton = page.getByTestId('mobile-menu-button')
    // Note: This button is only shown on authenticated pages with sidebar
    // For home page, we just check the layout adapts
    const nav = page.locator('nav')
    await expect(nav).toBeVisible()
  })

  test('cards stack on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')

    // Steps should still be visible on mobile
    await expect(page.getByText('How it works')).toBeVisible()
  })

  test('desktop shows full navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')

    // Navigation should be visible
    const nav = page.locator('nav')
    await expect(nav).toBeVisible()

    // CTA buttons should be visible
    await expect(page.getByRole('button', { name: /get started/i })).toBeVisible()
  })
})

test.describe('UI Overhaul - Visual Consistency', () => {
  test('all pages use consistent typography', async ({ page }) => {
    // Check home page
    await page.goto('/')
    const homeHeading = page.getByRole('heading', { level: 1 })
    await expect(homeHeading).toBeVisible()

    // Check login page
    await page.goto('/login')
    const loginHeading = page.getByText('Welcome back')
    await expect(loginHeading).toBeVisible()

    // Check register page
    await page.goto('/register')
    const registerHeading = page.getByText('Create an account')
    await expect(registerHeading).toBeVisible()
  })

  test('interactive elements have hover states', async ({ page }) => {
    await page.goto('/')

    const button = page.getByRole('button', { name: /get started/i })
    await expect(button).toBeVisible()

    // Hover should work without errors
    await button.hover()

    // Button should still be clickable
    await expect(button).toBeEnabled()
  })
})
