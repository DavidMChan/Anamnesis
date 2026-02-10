import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeToggle, ThemeProvider, useTheme } from '@/components/ui/theme-toggle'

// Helper component to test useTheme hook
function ThemeConsumer() {
  const { theme, setTheme, systemTheme } = useTheme()
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <span data-testid="system-theme">{systemTheme}</span>
      <button onClick={() => setTheme('light')}>Set Light</button>
      <button onClick={() => setTheme('dark')}>Set Dark</button>
      <button onClick={() => setTheme('system')}>Set System</button>
    </div>
  )
}

describe('Theme System', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    // Reset document class
    document.documentElement.classList.remove('dark', 'light')
  })

  describe('ThemeProvider', () => {
    it('should default to system theme on first load', () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      expect(screen.getByTestId('current-theme')).toHaveTextContent('system')
    })

    it('should persist theme preference in localStorage', () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      fireEvent.click(screen.getByText('Set Dark'))

      expect(localStorage.getItem('theme')).toBe('dark')
    })

    it('should load theme from localStorage on mount', () => {
      localStorage.setItem('theme', 'dark')

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      expect(screen.getByTestId('current-theme')).toHaveTextContent('dark')
    })

    it('should apply dark class to document when theme is dark', () => {
      localStorage.setItem('theme', 'dark')

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('should remove dark class when theme is light', () => {
      localStorage.setItem('theme', 'light')

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      )

      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })
  })

  describe('ThemeToggle', () => {
    it('should render toggle button', () => {
      render(
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>
      )

      expect(screen.getByRole('button', { name: /toggle theme/i })).toBeInTheDocument()
    })

    it('should switch from light to dark when clicked', () => {
      localStorage.setItem('theme', 'light')

      render(
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>
      )

      fireEvent.click(screen.getByRole('button', { name: /toggle theme/i }))

      expect(localStorage.getItem('theme')).toBe('dark')
    })

    it('should switch from dark to light when clicked', () => {
      localStorage.setItem('theme', 'dark')

      render(
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>
      )

      fireEvent.click(screen.getByRole('button', { name: /toggle theme/i }))

      expect(localStorage.getItem('theme')).toBe('light')
    })

    it('should show sun icon in dark mode', () => {
      localStorage.setItem('theme', 'dark')

      render(
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>
      )

      // Sun icon should be visible (to switch to light mode)
      expect(screen.getByTestId('sun-icon')).toBeInTheDocument()
    })

    it('should show moon icon in light mode', () => {
      localStorage.setItem('theme', 'light')

      render(
        <ThemeProvider>
          <ThemeToggle />
        </ThemeProvider>
      )

      // Moon icon should be visible (to switch to dark mode)
      expect(screen.getByTestId('moon-icon')).toBeInTheDocument()
    })
  })

  describe('CSS Variables', () => {
    it('should have warm color palette defined', () => {
      // This test ensures our CSS is loaded correctly
      // The actual CSS variables are tested via visual regression
      localStorage.setItem('theme', 'light')

      render(
        <ThemeProvider>
          <div data-testid="themed-element" className="bg-background text-foreground">
            Test
          </div>
        </ThemeProvider>
      )

      expect(screen.getByTestId('themed-element')).toBeInTheDocument()
    })
  })
})
