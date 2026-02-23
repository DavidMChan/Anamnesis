import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SurveyRunProgress } from '@/components/surveys/SurveyRunProgress'
import type { SurveyRun } from '@/types/database'

// Mock supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [] }),
    })),
  },
}))

const createMockRun = (overrides: Partial<SurveyRun> = {}): SurveyRun => ({
  id: 'run-1',
  survey_id: 'survey-1',
  status: 'running',
  total_tasks: 100,
  completed_tasks: 30,
  failed_tasks: 2,
  results: {},
  error_log: [],
  llm_config: { provider: 'openrouter' },
  started_at: new Date(Date.now() - 60000).toISOString(),
  completed_at: null,
  created_at: new Date().toISOString(),
  ...overrides,
})

describe('SurveyRunProgress - Stop Run Button', () => {
  let mockOnCancel: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockOnCancel = vi.fn().mockResolvedValue(undefined)
  })

  it('shows "Stop Run" button when run status is running', () => {
    render(
      <SurveyRunProgress
        run={createMockRun({ status: 'running' })}
        onCancel={mockOnCancel}
      />
    )

    expect(screen.getByRole('button', { name: /Stop Run/i })).toBeInTheDocument()
  })

  it('shows "Stop Run" button when run status is pending', () => {
    render(
      <SurveyRunProgress
        run={createMockRun({ status: 'pending' })}
        onCancel={mockOnCancel}
      />
    )

    expect(screen.getByRole('button', { name: /Stop Run/i })).toBeInTheDocument()
  })

  it('does NOT show "Stop Run" button when status is completed', () => {
    render(
      <SurveyRunProgress
        run={createMockRun({ status: 'completed' })}
        onCancel={mockOnCancel}
      />
    )

    expect(screen.queryByRole('button', { name: /Stop Run/i })).not.toBeInTheDocument()
  })

  it('does NOT show "Stop Run" button when status is failed', () => {
    render(
      <SurveyRunProgress
        run={createMockRun({ status: 'failed' })}
        onCancel={mockOnCancel}
      />
    )

    expect(screen.queryByRole('button', { name: /Stop Run/i })).not.toBeInTheDocument()
  })

  it('does NOT show "Stop Run" button when status is cancelled', () => {
    render(
      <SurveyRunProgress
        run={createMockRun({ status: 'cancelled' })}
        onCancel={mockOnCancel}
      />
    )

    expect(screen.queryByRole('button', { name: /Stop Run/i })).not.toBeInTheDocument()
  })

  it('does NOT show "Stop Run" button when onCancel is not provided', () => {
    render(
      <SurveyRunProgress
        run={createMockRun({ status: 'running' })}
      />
    )

    expect(screen.queryByRole('button', { name: /Stop Run/i })).not.toBeInTheDocument()
  })

  it('shows confirmation dialog on "Stop Run" click', async () => {
    const user = userEvent.setup()
    render(
      <SurveyRunProgress
        run={createMockRun({ status: 'running' })}
        onCancel={mockOnCancel}
      />
    )

    await user.click(screen.getByRole('button', { name: /Stop Run/i }))

    expect(screen.getByText('Stop this survey run?')).toBeInTheDocument()
    expect(screen.getByText(/Tasks already in progress will finish/)).toBeInTheDocument()
  })

  it('calls onCancel callback after confirmation', async () => {
    const user = userEvent.setup()
    render(
      <SurveyRunProgress
        run={createMockRun({ status: 'running' })}
        onCancel={mockOnCancel}
      />
    )

    // Open dialog
    await user.click(screen.getByRole('button', { name: /Stop Run/i }))

    // Click the confirm button in the dialog
    const confirmButton = screen.getByRole('button', { name: 'Stop Run', exact: true })
    // There should be two "Stop Run" buttons now - the trigger and the confirm
    // The dialog confirm is the AlertDialogAction
    const allStopButtons = screen.getAllByRole('button', { name: /Stop Run/i })
    // Click the one inside the dialog (the last one)
    await user.click(allStopButtons[allStopButtons.length - 1])

    await waitFor(() => {
      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })
  })

  it('does not call onCancel when dialog is cancelled', async () => {
    const user = userEvent.setup()
    render(
      <SurveyRunProgress
        run={createMockRun({ status: 'running' })}
        onCancel={mockOnCancel}
      />
    )

    // Open dialog
    await user.click(screen.getByRole('button', { name: /Stop Run/i }))

    // Click Cancel
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mockOnCancel).not.toHaveBeenCalled()
  })
})
