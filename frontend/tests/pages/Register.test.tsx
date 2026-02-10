import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Register } from '@/pages/Register'

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
  signInWithGoogle: vi.fn(),
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
    useLocation: () => ({ pathname: '/register', state: null }),
  }
})

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Register />
    </MemoryRouter>
  )
}

describe('Register Page - Auth Redirect Guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigatedTo = null
    // Reset to unauthenticated state
    mockAuthContext.user = null
    mockAuthContext.loading = false
  })

  describe('Unauthenticated User', () => {
    it('should show the register form when user is not logged in', () => {
      mockAuthContext.user = null

      renderRegister()

      expect(screen.getByText('Create an account')).toBeInTheDocument()
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument()
    })

    it('should show Google button above email form', () => {
      mockAuthContext.user = null

      renderRegister()

      const googleButton = screen.getByRole('button', { name: /continue with google/i })
      expect(googleButton).toBeInTheDocument()
    })

    it('should show divider with "or" text between Google button and form', () => {
      mockAuthContext.user = null

      renderRegister()

      expect(screen.getByText('or')).toBeInTheDocument()
    })
  })

  describe('Authenticated User', () => {
    it('should redirect to /surveys when user is already logged in', () => {
      mockAuthContext.user = mockUser

      renderRegister()

      expect(navigatedTo).toBe('/surveys')
      expect(screen.queryByText('Create an account')).not.toBeInTheDocument()
    })
  })
})
