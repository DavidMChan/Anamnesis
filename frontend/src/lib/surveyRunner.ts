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
 * 1. Gets survey config (including sample size from demographics._sample_size)
 * 2. Gets matching backstory IDs (applying sample size limit if set)
 * 3. Creates a survey_run record
 * 4. Creates survey_task records for each backstory
 * 5. Publishes tasks to the message queue (via edge function)
 */
export async function createSurveyRun(
  options: CreateSurveyRunOptions
): Promise<CreateSurveyRunResult> {
  const { surveyId, llmConfig } = options

  try {
    // 1. Get survey to check for sample size setting
    const { data: survey, error: surveyError } = await supabase
      .from('surveys')
      .select('demographics')
      .eq('id', surveyId)
      .single()

    if (surveyError) {
      return { success: false, error: surveyError.message }
    }

    // Extract sample size from demographics (stored as _sample_size: [number])
    const demographics = survey?.demographics as Record<string, unknown> | null
    const sampleSizeArray = demographics?._sample_size as number[] | undefined
    const sampleSize = sampleSizeArray?.[0]

    console.log('[createSurveyRun] demographics:', demographics)
    console.log('[createSurveyRun] sampleSize:', sampleSize)

    // 2. Get matching backstories (all public for now, with optional limit)
    let query = supabase.from('backstories').select('id').eq('is_public', true)

    // Apply sample size limit if set
    if (sampleSize && sampleSize > 0) {
      console.log('[createSurveyRun] Applying limit:', sampleSize)
      query = query.limit(sampleSize)
    }

    const { data: backstories, error: backstoriesError } = await query

    console.log('[createSurveyRun] backstories count:', backstories?.length)

    if (backstoriesError) {
      return { success: false, error: backstoriesError.message }
    }

    if (!backstories || backstories.length === 0) {
      return { success: false, error: 'No backstories found to run survey on' }
    }

    const backstoryIds = backstories.map((b) => b.id)

    // 2. Create survey run with 'pending' status
    // IMPORTANT: We create with 'pending' first, insert all tasks, then update to 'running'
    // This prevents the dispatcher from picking up the run before all tasks are created
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

    // 4. Keep run as 'pending' - dispatcher will:
    //    - Find pending runs
    //    - Publish tasks to RabbitMQ
    //    - Update status to 'running'
    // DO NOT update status here - let dispatcher handle it

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
