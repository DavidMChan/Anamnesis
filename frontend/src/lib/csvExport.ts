import { supabase } from '@/lib/supabase'
import { getModelName } from '@/lib/llmConfig'
import type { Survey, SurveyRun, SurveyResults, SurveyTaskResult, Question } from '@/types/database'

function mapAnswerToOption(answer: string, question: Question): string {
  if (!question.options || question.type === 'open_response') return answer
  const index = answer.charCodeAt(0) - 'A'.charCodeAt(0)
  if (index >= 0 && index < question.options.length) {
    return question.options[index]
  }
  return answer
}

/** Fetch completed task results from survey_tasks — the source of truth. */
async function fetchTaskResults(runId: string): Promise<SurveyResults> {
  const { data: tasks } = await supabase
    .from('survey_tasks')
    .select('id, backstory_id, result')
    .eq('survey_run_id', runId)
    .eq('status', 'completed')

  const results: SurveyResults = {}
  for (const task of tasks ?? []) {
    if (task.result) {
      results[task.backstory_id ?? task.id] = task.result as SurveyTaskResult
    }
  }
  return results
}

export async function generateSurveyCSV(
  survey: Survey,
  run: SurveyRun,
): Promise<{ blob: Blob; filename: string }> {
  const isZeroShot = run.algorithm === 'zero_shot_baseline'

  // Always fetch from survey_tasks — run.results JSONB may be empty/stale
  const results = await fetchTaskResults(run.id)

  const modelName = getModelName(run.llm_config) ?? 'unknown'
  const modelSlug = modelName.replace(/\//g, '-').replace(/[^a-zA-Z0-9._-]/g, '_')

  // --- Backstory demographics ---
  let backstoryMap: Map<string, Record<string, unknown>> = new Map()
  if (!isZeroShot) {
    const backstoryIds = Object.keys(results)
    if (backstoryIds.length > 0) {
      const { data } = await supabase.rpc('get_backstory_demographics', {
        backstory_ids: backstoryIds,
      })
      if (data) {
        backstoryMap = new Map(
          (data as { id: string; demographics: Record<string, unknown> }[]).map((b) => [
            b.id,
            b.demographics,
          ])
        )
      }
    }
  }

  // --- Aggregate cost from tasks ---
  const totalCost = Object.values(results).reduce((sum, r) => {
    return sum + (r.__meta__?.usage?.cost ?? 0)
  }, 0)
  const responseCount = Object.keys(results).length

  // --- Metadata block (comment rows at top) ---
  const escape = (cell: string) => `"${String(cell).replace(/"/g, '""')}"`
  const meta = (label: string, value: string | number) =>
    [escape(`# ${label}`), escape(String(value))].join(',')

  const metaRows = [
    meta('Survey', survey.name ?? 'Untitled'),
    meta('Run ID', run.id),
    meta('Date', new Date(run.created_at).toISOString().slice(0, 19).replace('T', ' ')),
    meta('Algorithm', run.algorithm),
    meta('Model', modelName),
    meta('Provider', run.llm_config.provider ?? ''),
    meta('Temperature', run.llm_config.temperature ?? ''),
    meta('Max Tokens', run.llm_config.max_tokens ?? ''),
    meta('Max Concurrent Tasks', run.llm_config.max_concurrent_tasks ?? ''),
    meta('Sample Size', responseCount),
    meta('Total Cost (USD)', `$${totalCost.toFixed(6)}`),
    ...(responseCount > 0
      ? [meta('Cost per Response (USD)', `$${(totalCost / responseCount).toFixed(6)}`)]
      : []),
    ...(() => {
      const stopSummary = run.llm_config.adaptive_sampling?.stop_summary
      if (!stopSummary) return []
      return [
        meta('Early Stopping Confidence Lower Bound', `${(stopSummary.confidence_lower_bound * 100).toFixed(2)}%`),
        meta('Early Stopping Sample Count', stopSummary.sample_count),
        meta('Early Stopping Epsilon', stopSummary.epsilon),
      ]
    })(),
    '', // blank separator row
  ]

  // --- Data headers ---
  const questionHeaders = survey.questions.map((q) => `${q.qkey}: ${q.text}`)
  const firstCol = isZeroShot ? 'trial_index' : 'backstory_id'
  const usageHeaders = [
    'usage_cost_usd',
    'usage_audio_tokens',
    'usage_prompt_tokens',
    'usage_completion_tokens',
    'usage_total_tokens',
    'usage_api_calls',
  ]
  const dataHeaders = isZeroShot
    ? [firstCol, ...usageHeaders, ...questionHeaders]
    : [firstCol, 'demographics', ...usageHeaders, ...questionHeaders]

  const dataRows = Object.entries(results).map(([backstoryId, responses], index) => {
    const firstColValue = isZeroShot ? `Trial ${index + 1}` : backstoryId
    const demographics = backstoryMap.get(backstoryId)
    const demographicsStr = demographics ? JSON.stringify(demographics) : ''
    const usage = responses.__meta__?.usage

    return [
      firstColValue,
      ...(isZeroShot ? [] : [demographicsStr]),
      usage?.cost ?? '',
      usage?.audio_tokens ?? '',
      usage?.prompt_tokens ?? '',
      usage?.completion_tokens ?? '',
      usage?.total_tokens ?? '',
      usage?.api_calls ?? '',
      ...survey.questions.map((q) => {
        const answer = responses[q.qkey]
        if (!answer) return ''

        if (q.type === 'ranking' && typeof answer === 'string' && q.options) {
          return answer
            .split(',')
            .map((s) => s.trim())
            .map((letter) => {
              const idx = letter.charCodeAt(0) - 'A'.charCodeAt(0)
              return q.options && idx >= 0 && idx < q.options.length ? q.options[idx] : letter
            })
            .join(' > ')
        }

        if (Array.isArray(answer)) {
          return answer.map((a) => mapAnswerToOption(a, q)).join('; ')
        }

        if (typeof answer === 'string' && answer.includes(',') && q.type === 'multiple_select') {
          return answer
            .split(',')
            .map((s) => mapAnswerToOption(s.trim(), q))
            .join('; ')
        }

        return mapAnswerToOption(answer as string, q)
      }),
    ]
  })

  const csvLines = [
    ...metaRows,
    dataHeaders.map(escape).join(','),
    ...dataRows.map((row) => row.map((cell) => escape(String(cell))).join(',')),
  ]

  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const slugName = (survey.name ?? 'survey').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '')
  const runDate = new Date(run.created_at).toISOString().slice(0, 10)
  const filename = `${slugName}_${modelSlug}_sample_${responseCount}_${runDate}.csv`

  return { blob, filename }
}

export async function downloadSurveyCSV(survey: Survey, run: SurveyRun): Promise<void> {
  const { blob, filename } = await generateSurveyCSV(survey, run)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
