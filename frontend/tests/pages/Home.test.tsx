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

// Track navigation
let navigatedTo: string | null = null

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => {
      navigatedTo = to
      return <div data-testid="navigate-mock">Redirecting to {to}</div>
    },
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/', state: null }),
  }
})

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Home />
    </MemoryRouter>
  )
}

describe('Home Page - Auth Redirect Guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigatedTo = null
    // Reset to unauthenticated state
    mockAuthContext.user = null
    mockAuthContext.loading = false
  })

  describe('Unauthenticated User', () => {
    it('should show the home page content when user is not logged in', () => {
      mockAuthContext.user = null

      renderHome()

      expect(screen.getByText('Survey Arena')).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/understand how/i)
      // There are multiple "Sign In" links (navbar and hero), just check at least one exists
      const signInLinks = screen.getAllByRole('link', { name: /sign in/i })
      expect(signInLinks.length).toBeGreaterThan(0)
      const getStartedLinks = screen.getAllByRole('link', { name: /get started/i })
      expect(getStartedLinks.length).toBeGreaterThan(0)
    })
  })

  describe('Authenticated User', () => {
    it('should redirect to /surveys when user is already logged in', () => {
      mockAuthContext.user = mockUser

      renderHome()

      expect(navigatedTo).toBe('/surveys')
      // Should not show the home page hero content
      expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    })
  })
})
