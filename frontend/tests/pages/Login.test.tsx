import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Login } from '@/pages/Login'

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
    useLocation: () => ({ pathname: '/login', state: null }),
  }
})

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>
  )
}

describe('Login Page - Auth Redirect Guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigatedTo = null
    // Reset to unauthenticated state
    mockAuthContext.user = null
    mockAuthContext.loading = false
  })

  describe('Unauthenticated User', () => {
    it('should show the login form when user is not logged in', () => {
      mockAuthContext.user = null

      renderLogin()

      expect(screen.getByText('Welcome back')).toBeInTheDocument()
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    })
  })

  describe('Authenticated User', () => {
    it('should redirect to /surveys when user is already logged in', () => {
      mockAuthContext.user = mockUser

      renderLogin()

      expect(navigatedTo).toBe('/surveys')
      expect(screen.queryByText('Welcome back')).not.toBeInTheDocument()
    })
  })
})
