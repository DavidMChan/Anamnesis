import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { Settings } from '@/pages/Settings'
import { AuthContext } from '@/contexts/AuthContext'
import type { User } from '@/types/database'

interface MaskedApiKeys {
  openrouter: string | null
  vllm: string | null
}

interface MockAuthContext {
  user: { id: string } | null
  profile: User | null
  session: null
  loading: boolean
  maskedApiKey: string | null
  maskedApiKeys: MaskedApiKeys
  signIn: ReturnType<typeof vi.fn>
  signUp: ReturnType<typeof vi.fn>
  signOut: ReturnType<typeof vi.fn>
  signInWithGoogle: ReturnType<typeof vi.fn>
  updateProfile: ReturnType<typeof vi.fn>
  storeApiKey: ReturnType<typeof vi.fn>
  clearApiKey: ReturnType<typeof vi.fn>
  refreshMaskedApiKeys: ReturnType<typeof vi.fn>
}

const createMockAuthContext = (overrides: Partial<MockAuthContext> = {}): MockAuthContext => ({
  user: { id: 'test-user-id' },
  profile: {
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
    llm_config: { provider: 'openrouter', openrouter_model: 'test-model' },
    created_at: '2024-01-01',
  },
  session: null,
  loading: false,
  maskedApiKey: null,
  maskedApiKeys: { openrouter: null, vllm: null },
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  signInWithGoogle: vi.fn(),
  updateProfile: vi.fn().mockResolvedValue({ error: null }),
  storeApiKey: vi.fn().mockResolvedValue({ error: null, success: true }),
  clearApiKey: vi.fn().mockResolvedValue({ error: null, success: true }),
  refreshMaskedApiKeys: vi.fn().mockResolvedValue({ openrouter: null, vllm: null }),
  ...overrides,
})

const renderSettings = (authContext: MockAuthContext) => {
  return render(
    <BrowserRouter>
      <AuthContext.Provider value={authContext}>
        <Settings />
      </AuthContext.Provider>
    </BrowserRouter>
  )
}

describe('Settings Page - Max Concurrent Tasks', () => {
  let mockAuthContext: MockAuthContext

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthContext = createMockAuthContext()
  })

  it('renders max_concurrent_tasks input with default value 10', () => {
    renderSettings(mockAuthContext)

    const input = screen.getByLabelText('Max Concurrent Tasks')
    expect(input).toBeInTheDocument()
    expect(input).toHaveValue(10)
  })

  it('renders max_concurrent_tasks input with current value from llm_config', () => {
    mockAuthContext = createMockAuthContext({
      profile: {
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User',
        llm_config: { provider: 'openrouter', openrouter_model: 'test-model', max_concurrent_tasks: 25 },
        created_at: '2024-01-01',
      },
    })
    renderSettings(mockAuthContext)

    const input = screen.getByLabelText('Max Concurrent Tasks')
    expect(input).toHaveValue(25)
  })

  it('saves max_concurrent_tasks to llm_config when form is submitted', async () => {
    const user = userEvent.setup()
    renderSettings(mockAuthContext)

    // Change the value using fireEvent.change for number inputs
    const input = screen.getByLabelText('Max Concurrent Tasks')
    fireEvent.change(input, { target: { value: '50' } })

    // Save
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(mockAuthContext.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          llm_config: expect.objectContaining({
            max_concurrent_tasks: 50,
          }),
        })
      )
    })
  })

  it('validates min=1 for concurrency input', async () => {
    const user = userEvent.setup()
    renderSettings(mockAuthContext)

    const input = screen.getByLabelText('Max Concurrent Tasks')
    expect(input).toHaveAttribute('min', '1')
  })

  it('validates max=200 for concurrency input', async () => {
    const user = userEvent.setup()
    renderSettings(mockAuthContext)

    const input = screen.getByLabelText('Max Concurrent Tasks')
    expect(input).toHaveAttribute('max', '200')
  })

  it('shows guidance text for concurrency setting', () => {
    renderSettings(mockAuthContext)

    expect(screen.getByText(/Maximum parallel LLM requests per survey run/)).toBeInTheDocument()
  })
})
