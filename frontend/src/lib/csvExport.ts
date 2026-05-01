import { supabase } from '@/lib/supabase'
import type { Survey, SurveyRun, SurveyResults, Question } from '@/types/database'

function mapAnswerToOption(answer: string, question: Question): string {
  if (!question.options || question.type === 'open_response') return answer
  const index = answer.charCodeAt(0) - 'A'.charCodeAt(0)
  if (index >= 0 && index < question.options.length) {
    return question.options[index]
  }
  return answer
}

export async function generateSurveyCSV(
  survey: Survey,
  run: SurveyRun,
  results: SurveyResults,
): Promise<{ blob: Blob; filename: string }> {
  const isZeroShot = run.algorithm === 'zero_shot_baseline'

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
  const headers = isZeroShot
    ? [firstCol, ...usageHeaders, ...questionHeaders]
    : [firstCol, 'demographics', ...usageHeaders, ...questionHeaders]

  const rows = Object.entries(results).map(([backstoryId, responses], index) => {
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
          const ranking = answer.split(',').map((s) => s.trim())
          return ranking
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

  const escape = (cell: string) => `"${cell.replace(/"/g, '""')}"`
  const csvContent = [
    headers.map(escape).join(','),
    ...rows.map((row) => row.map((cell) => escape(String(cell))).join(',')),
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const sampleSize = Object.keys(results).length
  const slugName = (survey.name || 'survey').replace(/\s+/g, '_')
  const filename = `${slugName}_${run.algorithm}_sample_${sampleSize}.csv`

  return { blob, filename }
}

export async function downloadSurveyCSV(
  survey: Survey,
  run: SurveyRun,
  results: SurveyResults,
): Promise<void> {
  const { blob, filename } = await generateSurveyCSV(survey, run, results)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
