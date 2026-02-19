import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { Settings } from '@/pages/Settings'
import { AuthContext } from '@/contexts/AuthContext'
import type { User } from '@/types/database'

// Mock the useAuth hook return type
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
    llm_config: { provider: 'openrouter', openrouter_model: 'anthropic/claude-3-haiku' },
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

describe('Settings Page - API Key Management', () => {
  let mockAuthContext: MockAuthContext

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthContext = createMockAuthContext()
  })

  describe('Display State', () => {
    it('shows "Add" button when no API key is configured', () => {
      renderSettings(mockAuthContext)

      // Should have an Add button for the OpenRouter API key
      const addButtons = screen.getAllByRole('button', { name: 'Add' })
      expect(addButtons.length).toBeGreaterThan(0)
    })

    it('shows masked API key and "Change" button when key exists', () => {
      mockAuthContext = createMockAuthContext({
        maskedApiKeys: { openrouter: 'sk-or...def', vllm: null },
      })
      renderSettings(mockAuthContext)

      expect(screen.getByDisplayValue('sk-or...def')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
      expect(screen.getByTitle('Remove API key')).toBeInTheDocument()
    })

    it('shows Vault security message when key exists', () => {
      mockAuthContext = createMockAuthContext({
        maskedApiKeys: { openrouter: 'sk-or...def', vllm: null },
      })
      renderSettings(mockAuthContext)

      expect(screen.getByText(/encrypted and stored securely in Supabase Vault/)).toBeInTheDocument()
    })
  })

  describe('Edit Mode', () => {
    it('enters edit mode when "Add" button is clicked', async () => {
      const user = userEvent.setup()
      renderSettings(mockAuthContext)

      // Click the first Add button (OpenRouter)
      const addButtons = screen.getAllByRole('button', { name: 'Add' })
      await user.click(addButtons[0])

      expect(screen.getByPlaceholderText('Enter API key...')).toBeInTheDocument()
      expect(screen.getByTitle('Cancel')).toBeInTheDocument()
    })

    it('enters edit mode when "Change" button is clicked', async () => {
      const user = userEvent.setup()
      mockAuthContext = createMockAuthContext({
        maskedApiKeys: { openrouter: 'sk-or...def', vllm: null },
      })
      renderSettings(mockAuthContext)

      await user.click(screen.getByRole('button', { name: 'Change' }))

      expect(screen.getByPlaceholderText('Enter API key...')).toBeInTheDocument()
    })

    it('cancels edit mode without saving', async () => {
      const user = userEvent.setup()
      renderSettings(mockAuthContext)

      // Enter edit mode
      const addButtons = screen.getAllByRole('button', { name: 'Add' })
      await user.click(addButtons[0])

      // Type something
      await user.type(screen.getByPlaceholderText('Enter API key...'), 'sk-test')

      // Cancel
      await user.click(screen.getByTitle('Cancel'))

      // Should be back to display mode
      const newAddButtons = screen.getAllByRole('button', { name: 'Add' })
      expect(newAddButtons.length).toBeGreaterThan(0)
      expect(screen.queryByPlaceholderText('Enter API key...')).not.toBeInTheDocument()
    })

    it('toggles password visibility', async () => {
      const user = userEvent.setup()
      renderSettings(mockAuthContext)

      // Enter edit mode
      const addButtons = screen.getAllByRole('button', { name: 'Add' })
      await user.click(addButtons[0])

      const input = screen.getByPlaceholderText('Enter API key...')

      // Initially hidden
      expect(input).toHaveAttribute('type', 'password')

      // Click eye icon to show
      const toggleButton = input.parentElement?.querySelector('button')
      if (toggleButton) {
        await user.click(toggleButton)
      }

      // Should be visible
      expect(input).toHaveAttribute('type', 'text')
    })
  })

  describe('Save API Key', () => {
    it('saves new API key on form submit', async () => {
      const user = userEvent.setup()
      renderSettings(mockAuthContext)

      // Enter edit mode and type key
      const addButtons = screen.getAllByRole('button', { name: 'Add' })
      await user.click(addButtons[0])
      await user.type(screen.getByPlaceholderText('Enter API key...'), 'sk-newkey12345678')

      // Save the API key using the Save button in the API key field
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(mockAuthContext.storeApiKey).toHaveBeenCalledWith('sk-newkey12345678', 'openrouter')
      })
    })

    it('does not save empty API key', async () => {
      const user = userEvent.setup()
      renderSettings(mockAuthContext)

      // Enter edit mode but don't type anything
      const addButtons = screen.getAllByRole('button', { name: 'Add' })
      await user.click(addButtons[0])

      // The Save button should be disabled when input is empty
      const saveButton = screen.getByRole('button', { name: 'Save' })
      expect(saveButton).toBeDisabled()

      // storeApiKey should not be called for empty input
      expect(mockAuthContext.storeApiKey).not.toHaveBeenCalled()
    })

    it('shows success message after saving', async () => {
      const user = userEvent.setup()
      renderSettings(mockAuthContext)

      // Save without entering edit mode (just profile changes)
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))

      await waitFor(() => {
        expect(screen.getByText('Changes saved!')).toBeInTheDocument()
      })
    })
  })

  describe('Clear API Key', () => {
    it('clears API key when remove button is clicked', async () => {
      const user = userEvent.setup()
      mockAuthContext = createMockAuthContext({
        maskedApiKeys: { openrouter: 'sk-or...def', vllm: null },
      })
      renderSettings(mockAuthContext)

      // Click remove button
      await user.click(screen.getByTitle('Remove API key'))

      await waitFor(() => {
        expect(mockAuthContext.clearApiKey).toHaveBeenCalledWith('openrouter')
      })
    })
  })

  describe('Profile Updates', () => {
    it('updates profile when saving', async () => {
      const user = userEvent.setup()
      renderSettings(mockAuthContext)

      // Save
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))

      await waitFor(() => {
        expect(mockAuthContext.updateProfile).toHaveBeenCalled()
      })
    })
  })
})
