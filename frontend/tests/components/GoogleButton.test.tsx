import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GoogleButton } from '@/components/ui/google-button'

// Create mock for useAuthContext
const mockSignInWithGoogle = vi.fn()
const mockAuthContext = {
  user: null,
  profile: null,
  loading: false,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  signInWithGoogle: mockSignInWithGoogle,
  session: null,
  updateProfile: vi.fn(),
}

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => mockAuthContext,
}))

describe('GoogleButton Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthContext.loading = false
  })

  it('should render with correct text "Continue with Google"', () => {
    render(<GoogleButton />)

    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument()
  })

  it('should show Google logo/icon', () => {
    render(<GoogleButton />)

    // The Google logo is an SVG, check for its presence
    const button = screen.getByRole('button', { name: /continue with google/i })
    const svg = button.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('should call signInWithGoogle when clicked', async () => {
    render(<GoogleButton />)

    const button = screen.getByRole('button', { name: /continue with google/i })
    fireEvent.click(button)

    expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1)
  })

  it('should show loading state when auth is in progress', () => {
    mockAuthContext.loading = true
    render(<GoogleButton />)

    const button = screen.getByRole('button')
    // Button should show loading spinner (Loader2 icon)
    expect(button.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('should be disabled when authLoading is true', () => {
    mockAuthContext.loading = true
    render(<GoogleButton />)

    const button = screen.getByRole('button', { name: /continue with google/i })
    expect(button).toBeDisabled()
  })

  it('should have proper styling - white background with border', () => {
    render(<GoogleButton />)

    const button = screen.getByRole('button', { name: /continue with google/i })
    // Check for classes that indicate white/outlined style
    expect(button).toHaveClass('bg-white')
  })

  it('should have accessible aria-label', () => {
    render(<GoogleButton />)

    const button = screen.getByRole('button', { name: /continue with google/i })
    expect(button).toBeInTheDocument()
  })
})
