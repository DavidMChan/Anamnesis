/**
 * Survey runner - functions to create and manage survey runs
 */
import { supabase } from './supabase'
import { applyDemographicFilters } from './backstoryFilters'
import type { LLMConfig, SurveyRun, DemographicFilter } from '@/types/database'

interface CreateSurveyRunOptions {
  surveyId: string
  llmConfig: LLMConfig
  demographics: DemographicFilter
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
  const { surveyId, llmConfig, demographics: rawDemographics } = options

  try {
    // Extract sample size from demographics param
    const { _sample_size, ...demographics } = rawDemographics as DemographicFilter & { _sample_size?: number[] }
    const sampleSize = _sample_size?.[0]

    console.log('[createSurveyRun] demographics:', demographics)
    console.log('[createSurveyRun] sampleSize:', sampleSize)

    // 2. Get matching backstories with demographic filters
    // TODO: Remove .neq('anthology') once anthology backstories have demographics
    let query = supabase.from('backstories').select('id').eq('is_public', true).neq('source_type', 'anthology')

    // Apply demographic filters
    if (demographics) {
      query = applyDemographicFilters(query, demographics)
    }

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
        demographics: rawDemographics,
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
 * Create a new demographic survey run.
 *
 * Targets ALL public non-anthology backstories (no demographic filters, no sample size).
 */
export async function createDemographicSurveyRun(
  options: Omit<CreateSurveyRunOptions, 'demographics'>
): Promise<CreateSurveyRunResult> {
  const { surveyId, llmConfig } = options

  try {
    // Get ALL public non-anthology backstories (no filters, no sample limit)
    const { data: backstories, error: backstoriesError } = await supabase
      .from('backstories')
      .select('id')
      .eq('is_public', true)
      .neq('source_type', 'anthology')

    if (backstoriesError) {
      return { success: false, error: backstoriesError.message }
    }

    if (!backstories || backstories.length === 0) {
      return { success: false, error: 'No public backstories found' }
    }

    const backstoryIds = backstories.map((b) => b.id)

    // Create survey run with 'pending' status
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
        demographics: {},
      })
      .select()
      .single()

    if (runError || !run) {
      return { success: false, error: runError?.message || 'Failed to create run' }
    }

    // Create tasks for each backstory
    const tasks = backstoryIds.map((backstoryId) => ({
      survey_run_id: run.id,
      backstory_id: backstoryId,
      status: 'pending',
      attempts: 0,
    }))

    const { error: tasksError } = await supabase.from('survey_tasks').insert(tasks)

    if (tasksError) {
      await supabase.from('survey_runs').delete().eq('id', run.id)
      return { success: false, error: tasksError.message }
    }

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
 *
 * Uses the cancel_run RPC which atomically cancels the run and
 * all pending/queued tasks in a single transaction.
 */
export async function cancelSurveyRun(runId: string): Promise<boolean> {
  const { error } = await supabase.rpc('cancel_run', { p_run_id: runId })
  return !error
}

/**
 * Retry a single failed task.
 *
 * Resets the task to 'pending' and the run back to 'running' so the
 * dispatcher picks it up again.
 */
export async function retryTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('retry_task', { p_task_id: taskId })
  if (error) throw error
}
