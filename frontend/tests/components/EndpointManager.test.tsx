import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ContextType } from 'react'
import { EndpointManager } from '@/components/settings/EndpointManager'
import { AuthContext } from '@/contexts/AuthContext'
import type { LLMConfig } from '@/types/database'

const CONFIG: LLMConfig = {
  provider: 'vllm',
  active_endpoint_id: 'ep-one',
  vllm_endpoint: 'http://one:8000/v1',
  vllm_model: 'model-one',
  endpoints: [
    { id: 'ep-one', name: 'One', endpoint: 'http://one:8000/v1', model: 'model-one' },
    { id: 'ep-two', name: 'Two', endpoint: 'http://two:8000/v1', model: 'model-two' },
  ],
}

const createAuth = (overrides: Record<string, unknown> = {}) => ({
  user: { id: 'test-user-id' },
  profile: null,
  session: null,
  loading: false,
  maskedApiKeys: { openrouter: null, vllm: null },
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  signInWithGoogle: vi.fn(),
  updateProfile: vi.fn(),
  fetchMaskedApiKey: vi.fn().mockResolvedValue(null),
  storeApiKey: vi.fn().mockResolvedValue({ error: null, success: true }),
  clearApiKey: vi.fn().mockResolvedValue({ error: null, success: true }),
  refreshMaskedApiKeys: vi.fn(),
  ...overrides,
})

const renderManager = (auth: ReturnType<typeof createAuth>, onChange = vi.fn()) => {
  render(
    <AuthContext.Provider value={auth as unknown as ContextType<typeof AuthContext>}>
      <EndpointManager config={CONFIG} onChange={onChange} />
    </AuthContext.Provider>
  )
  return onChange
}

describe('EndpointManager - per-endpoint API keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads a masked key for every endpoint', async () => {
    const auth = createAuth({
      fetchMaskedApiKey: vi
        .fn()
        .mockImplementation(async (keyType: string) =>
          keyType === 'vllm:ep-one' ? 'sk-on...one' : null
        ),
    })
    renderManager(auth)

    await waitFor(() => {
      expect(auth.fetchMaskedApiKey).toHaveBeenCalledWith('vllm:ep-one')
      expect(auth.fetchMaskedApiKey).toHaveBeenCalledWith('vllm:ep-two')
    })
    expect(await screen.findByDisplayValue('sk-on...one')).toBeInTheDocument()
  })

  it('stores a new key under the endpoint id', async () => {
    const user = userEvent.setup()
    const auth = createAuth()
    renderManager(auth)

    // One "Add" per endpoint key field ("Add endpoint" is a separate label).
    const addButtons = await screen.findAllByRole('button', { name: 'Add' })
    await user.click(addButtons[0])
    await user.type(screen.getByPlaceholderText('Enter API key...'), 'sk-endpoint-one')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(auth.storeApiKey).toHaveBeenCalledWith('sk-endpoint-one', 'vllm:ep-one')
    })
  })

  it('deletes the key when its endpoint is removed', async () => {
    const user = userEvent.setup()
    const auth = createAuth()
    const onChange = renderManager(auth)

    await user.click(screen.getByRole('button', { name: 'Remove Two' }))

    await waitFor(() => {
      expect(auth.clearApiKey).toHaveBeenCalledWith('vllm:ep-two')
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoints: [expect.objectContaining({ id: 'ep-one' })],
      })
    )
  })
})
