import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Home } from '@/pages/Home'

// Mock user object
const mockUser = { id: 'test-user-id', email: 'test@example.com' }

// Create mock for useAuthContext
const mockAuthContext = {
  user: null as typeof mockUser | null,
  profile: null,
  loading: false,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  session: null,
  updateProfile: vi.fn(),
}

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => mockAuthContext,
}))

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Home />
    </MemoryRouter>
  )
}

describe('Home Page - Auth-aware CTAs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to unauthenticated state
    mockAuthContext.user = null
    mockAuthContext.loading = false
  })

  describe('Unauthenticated User', () => {
    it('should show the home page content when user is not logged in', () => {
      mockAuthContext.user = null

      renderHome()

      expect(screen.getByRole('link', { name: /anamnesis home/i })).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/conditioning llms to simulate/i)
      expect(screen.getByRole('heading', { name: /random labels don’t reproduce real populations/i })).toBeInTheDocument()
      const signInLinks = screen.getAllByRole('link', { name: /sign in/i })
      expect(signInLinks.length).toBeGreaterThan(0)
      const getStartedLinks = screen.getAllByRole('link', { name: /get started/i })
      expect(getStartedLinks.length).toBeGreaterThan(0)
      expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument()
    })
  })

  describe('Authenticated User', () => {
    it('should stay on the home page and show a Dashboard CTA instead of redirecting', () => {
      mockAuthContext.user = mockUser

      renderHome()

      // Should still show the home page hero content
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/conditioning llms to simulate/i)

      // Header swaps Sign in/Get started for a Dashboard link to /surveys
      const dashboardLink = screen.getByRole('link', { name: /dashboard/i })
      expect(dashboardLink).toHaveAttribute('href', '/surveys')
      expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /get started/i })).not.toBeInTheDocument()
    })
  })
})
