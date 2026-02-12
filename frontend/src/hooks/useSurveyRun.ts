/**
 * Hook for managing survey run state and polling progress.
 */
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { SurveyRun, SurveyRunStatus } from '@/types/database'

interface UseSurveyRunOptions {
  /** Survey ID to fetch runs for */
  surveyId?: string
  /** Specific run ID to track */
  runId?: string
  /** Poll interval in milliseconds (default: 3000) */
  pollInterval?: number
  /** Whether to auto-poll when run is in progress */
  autoPoll?: boolean
}

interface UseSurveyRunResult {
  /** Current/latest run */
  run: SurveyRun | null
  /** All runs for the survey */
  runs: SurveyRun[]
  /** Loading state */
  loading: boolean
  /** Error message */
  error: string | null
  /** Progress percentage (0-100) */
  progress: number
  /** Whether run is in progress */
  isRunning: boolean
  /** Manually refresh the data */
  refresh: () => Promise<void>
}

export function useSurveyRun(options: UseSurveyRunOptions = {}): UseSurveyRunResult {
  const { surveyId, runId, pollInterval = 3000, autoPoll = true } = options

  const [run, setRun] = useState<SurveyRun | null>(null)
  const [runs, setRuns] = useState<SurveyRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRun = useCallback(async () => {
    if (!surveyId && !runId) {
      setLoading(false)
      return
    }

    try {
      if (runId) {
        // Fetch specific run
        const { data, error: fetchError } = await supabase
          .from('survey_runs')
          .select('*')
          .eq('id', runId)
          .single()

        if (fetchError) throw fetchError
        setRun(data as SurveyRun)
      } else if (surveyId) {
        // Fetch all runs for survey
        const { data, error: fetchError } = await supabase
          .from('survey_runs')
          .select('*')
          .eq('survey_id', surveyId)
          .order('created_at', { ascending: false })

        if (fetchError) throw fetchError

        const typedRuns = (data || []) as SurveyRun[]
        setRuns(typedRuns)
        setRun(typedRuns[0] || null) // Latest run
      }

      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch run')
    } finally {
      setLoading(false)
    }
  }, [surveyId, runId])

  // Initial fetch
  useEffect(() => {
    fetchRun()
  }, [fetchRun])

  // Auto-poll when run is in progress
  useEffect(() => {
    if (!autoPoll || !run) return

    const isInProgress = run.status === 'pending' || run.status === 'running'
    if (!isInProgress) return

    const intervalId = setInterval(fetchRun, pollInterval)

    return () => clearInterval(intervalId)
  }, [autoPoll, run, pollInterval, fetchRun])

  // Calculate progress
  const progress = run ? calculateProgress(run) : 0
  const isRunning = run?.status === 'pending' || run?.status === 'running'

  return {
    run,
    runs,
    loading,
    error,
    progress,
    isRunning,
    refresh: fetchRun,
  }
}

function calculateProgress(run: SurveyRun): number {
  if (run.total_tasks === 0) return 0
  const completed = run.completed_tasks + run.failed_tasks
  return Math.round((completed / run.total_tasks) * 100)
}

/**
 * Hook for creating a new survey run.
 */
export function useCreateSurveyRun() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createRun = useCallback(
    async (surveyId: string, llmConfig: Record<string, unknown>): Promise<string | null> => {
      setLoading(true)
      setError(null)

      try {
        // Get backstories
        const { data: backstories, error: backstoriesError } = await supabase
          .from('backstories')
          .select('id')
          .eq('is_public', true)

        if (backstoriesError) throw backstoriesError
        if (!backstories || backstories.length === 0) {
          throw new Error('No backstories found')
        }

        const backstoryIds = backstories.map((b) => b.id)

        // Create run
        const { data: run, error: runError } = await supabase
          .from('survey_runs')
          .insert({
            survey_id: surveyId,
            status: 'pending' as SurveyRunStatus,
            total_tasks: backstoryIds.length,
            completed_tasks: 0,
            failed_tasks: 0,
            results: {},
            error_log: [],
            llm_config: llmConfig,
          })
          .select()
          .single()

        if (runError) throw runError

        // Create tasks
        const tasks = backstoryIds.map((backstoryId) => ({
          survey_run_id: run.id,
          backstory_id: backstoryId,
          status: 'pending',
          attempts: 0,
        }))

        const { error: tasksError } = await supabase.from('survey_tasks').insert(tasks)

        if (tasksError) {
          await supabase.from('survey_runs').delete().eq('id', run.id)
          throw tasksError
        }

        // Update to running
        await supabase
          .from('survey_runs')
          .update({ status: 'running', started_at: new Date().toISOString() })
          .eq('id', run.id)

        // Mark survey as active
        await supabase.from('surveys').update({ status: 'active' }).eq('id', surveyId)

        return run.id
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create run')
        return null
      } finally {
        setLoading(false)
      }
    },
    []
  )

  return { createRun, loading, error }
}
