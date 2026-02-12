/**
 * Survey runner - functions to create and manage survey runs
 */
import { supabase } from './supabase'
import type { LLMConfig, SurveyRun } from '@/types/database'

interface CreateSurveyRunOptions {
  surveyId: string
  llmConfig: LLMConfig
}

interface CreateSurveyRunResult {
  success: boolean
  runId?: string
  error?: string
}

/**
 * Create a new survey run.
 *
 * This function:
 * 1. Gets all matching backstory IDs (for now, all public backstories)
 * 2. Creates a survey_run record
 * 3. Creates survey_task records for each backstory
 * 4. Publishes tasks to the message queue (via edge function)
 */
export async function createSurveyRun(
  options: CreateSurveyRunOptions
): Promise<CreateSurveyRunResult> {
  const { surveyId, llmConfig } = options

  try {
    // 1. Get matching backstories (all public for now)
    const { data: backstories, error: backstoriesError } = await supabase
      .from('backstories')
      .select('id')
      .eq('is_public', true)

    if (backstoriesError) {
      return { success: false, error: backstoriesError.message }
    }

    if (!backstories || backstories.length === 0) {
      return { success: false, error: 'No backstories found to run survey on' }
    }

    const backstoryIds = backstories.map((b) => b.id)

    // 2. Create survey run
    const { data: run, error: runError } = await supabase
      .from('survey_runs')
      .insert({
        survey_id: surveyId,
        status: 'pending',
        total_tasks: backstoryIds.length,
        completed_tasks: 0,
        failed_tasks: 0,
        results: {},
        error_log: [],
        llm_config: llmConfig,
      })
      .select()
      .single()

    if (runError || !run) {
      return { success: false, error: runError?.message || 'Failed to create run' }
    }

    // 3. Create tasks for each backstory
    const tasks = backstoryIds.map((backstoryId) => ({
      survey_run_id: run.id,
      backstory_id: backstoryId,
      status: 'pending',
      attempts: 0,
    }))

    const { error: tasksError } = await supabase.from('survey_tasks').insert(tasks)

    if (tasksError) {
      // Clean up the run if tasks failed
      await supabase.from('survey_runs').delete().eq('id', run.id)
      return { success: false, error: tasksError.message }
    }

    // 4. Update run status to running
    await supabase.from('survey_runs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', run.id)

    // 5. Mark survey as active (has been run at least once)
    await supabase.from('surveys').update({ status: 'active' }).eq('id', surveyId)

    // Note: Publishing to RabbitMQ would typically be done via an Edge Function
    // or the tasks are polled by the worker directly from the database

    return { success: true, runId: run.id }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

/**
 * Get the latest run for a survey.
 */
export async function getLatestSurveyRun(surveyId: string): Promise<SurveyRun | null> {
  const { data, error } = await supabase
    .from('survey_runs')
    .select('*')
    .eq('survey_id', surveyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    return null
  }

  return data as SurveyRun
}

/**
 * Get all runs for a survey.
 */
export async function getSurveyRuns(surveyId: string): Promise<SurveyRun[]> {
  const { data, error } = await supabase
    .from('survey_runs')
    .select('*')
    .eq('survey_id', surveyId)
    .order('created_at', { ascending: false })

  if (error || !data) {
    return []
  }

  return data as SurveyRun[]
}

/**
 * Get a specific survey run by ID.
 */
export async function getSurveyRun(runId: string): Promise<SurveyRun | null> {
  const { data, error } = await supabase
    .from('survey_runs')
    .select('*')
    .eq('id', runId)
    .single()

  if (error || !data) {
    return null
  }

  return data as SurveyRun
}

/**
 * Cancel a running survey.
 */
export async function cancelSurveyRun(runId: string): Promise<boolean> {
  const { error } = await supabase
    .from('survey_runs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', runId)

  return !error
}
