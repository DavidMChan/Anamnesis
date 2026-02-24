/**
 * Survey runner - functions to create and manage survey runs
 */
import { supabase } from './supabase'
import { applyDemographicFilters, isDemographicSelectionConfig, selectBackstoryIds } from './backstoryFilters'
import type { LLMConfig, SurveyRun, DemographicFilter, DemographicSelectionConfig } from '@/types/database'

interface CreateSurveyRunOptions {
  surveyId: string
  llmConfig: LLMConfig
  demographics: DemographicFilter | DemographicSelectionConfig
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
 * 1. Gets matching backstory IDs (using distribution-based scoring or legacy filters)
 * 2. Creates a survey_run record
 * 3. Creates survey_task records for each backstory
 * 4. Dispatcher picks up pending runs and publishes to RabbitMQ
 */
export async function createSurveyRun(
  options: CreateSurveyRunOptions
): Promise<CreateSurveyRunResult> {
  const { surveyId, llmConfig, demographics: rawDemographics } = options

  try {
    let backstoryIds: string[]

    if (isDemographicSelectionConfig(rawDemographics)) {
      // New distribution-based selection
      console.log('[createSurveyRun] mode:', rawDemographics.mode)
      console.log('[createSurveyRun] sample_size:', rawDemographics.sample_size)
      console.log('[createSurveyRun] filters:', rawDemographics.filters)

      backstoryIds = await selectBackstoryIds(rawDemographics)
    } else {
      // Legacy value-based filtering
      const { _sample_size, ...demographics } = rawDemographics as DemographicFilter & { _sample_size?: number[] }
      const sampleSize = _sample_size?.[0]

      console.log('[createSurveyRun] legacy demographics:', demographics)
      console.log('[createSurveyRun] sampleSize:', sampleSize)

      let query = supabase.from('backstories').select('id').eq('is_public', true).neq('source_type', 'anthology')

      if (demographics) {
        query = applyDemographicFilters(query, demographics)
      }

      if (sampleSize && sampleSize > 0) {
        query = query.limit(sampleSize)
      }

      const { data: backstories, error: backstoriesError } = await query

      if (backstoriesError) {
        return { success: false, error: backstoriesError.message }
      }

      backstoryIds = (backstories || []).map((b) => b.id)
    }

    console.log('[createSurveyRun] backstories count:', backstoryIds.length)

    if (backstoryIds.length === 0) {
      return { success: false, error: 'No backstories found to run survey on' }
    }

    // Create survey run with 'pending' status
    // IMPORTANT: We create with 'pending' first, insert all tasks, then dispatcher sets to 'running'
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

    // Mark survey as active (has been run at least once)
    await supabase.from('surveys').update({ status: 'active' }).eq('id', surveyId)

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
