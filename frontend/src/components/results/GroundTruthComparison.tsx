/**
 * Ground Truth comparison view.
 *
 * Scores the matched virtual population against the uploaded human population
 * using the three Anthology Table 1 metrics (WD, Fro., alpha — see
 * `@/lib/groundTruthMetrics`), then shows per-question LLM-vs-truth
 * distributions with each question's Wasserstein distance.
 */
import { useMemo } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type {
  GroundTruthData,
  GroundTruthRespondent,
  Question,
  SurveyResults,
  SurveyTaskResult,
} from '@/types/database'
import {
  alignToOptions,
  cronbachAlpha,
  earthMoversDistance,
  frobeniusOfCorrelations,
  toOrdinal,
} from '@/lib/groundTruthMetrics'
import { Target } from 'lucide-react'

interface ComparisonProps {
  groundTruth: GroundTruthData
  questions: Question[]
  results: SurveyResults
}

interface PerQuestionStats {
  question: Question
  matchRate: number | null
  wd: number | null
  llmDistribution: Record<string, number>
  truthDistribution: Record<string, number>
}

interface RunMetrics {
  wd: number | null
  fro: number | null
  alphaHuman: number | null
  alphaLlm: number | null
  nSubjects: number
  kQuestions: number
}

export function GroundTruthComparison({ groundTruth, questions, results }: ComparisonProps) {
  const perQuestion = useMemo(
    () => buildPerQuestionStats(groundTruth, questions, results),
    [groundTruth, questions, results],
  )
  const metrics = useMemo(
    () => buildRunMetrics(groundTruth, questions, results, perQuestion),
    [groundTruth, questions, results, perQuestion],
  )

  if (!groundTruth.matches || groundTruth.matches.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Comparison not available</CardTitle>
          <CardDescription>
            Matches are still being computed, or no matches were produced for this run.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const truthQkeys = new Set(groundTruth.question_keys ?? [])

  return (
    <div className="space-y-4">
      <MatchingSummary groundTruth={groundTruth} />
      <EvalMetrics metrics={metrics} />
      {perQuestion
        .filter((s) => truthQkeys.has(s.question.qkey))
        .map((s) => (
          <QuestionComparison key={s.question.qkey} stats={s} />
        ))}
      {truthQkeys.size === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No ground truth answers in upload</CardTitle>
            <CardDescription>
              The uploaded CSV did not contain any <code>q&lt;qkey&gt;</code>{' '}
              columns. The matched backstories ran the survey, but there's
              nothing to compare against.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  )
}

function MatchingSummary({ groundTruth }: { groundTruth: GroundTruthData }) {
  const { stats, match_method, demographic_keys, mode } = groundTruth
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <CardTitle>Matching Summary</CardTitle>
        </div>
        <CardDescription>
          {match_method} match on {demographic_keys.join(', ')} ({mode})
        </CardDescription>
      </CardHeader>
      <CardContent>
        {stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <StatCell label="Respondents" value={stats.n_respondents} />
            <StatCell label="Pool size" value={stats.pool_size} />
            <StatCell
              label="Mean score"
              value={(stats.mean_score ?? 0).toFixed(4)}
            />
            <StatCell
              label="Median score"
              value={(stats.median_score ?? 0).toFixed(4)}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No stats available.</p>
        )}
      </CardContent>
    </Card>
  )
}

function EvalMetrics({ metrics }: { metrics: RunMetrics }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Distribution Alignment</CardTitle>
        <CardDescription>
          Virtual vs. real population · {metrics.nSubjects} subjects ·{' '}
          {metrics.kQuestions} MCQ items · unweighted
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <MetricCell label="WD ↓" value={metrics.wd} hint="avg Wasserstein" />
          <MetricCell label="Fro. ↓" value={metrics.fro} hint="corr. matrix" />
          <MetricCell label="α · LLM" value={metrics.alphaLlm} hint="Cronbach's α" />
          <MetricCell label="α · Human" value={metrics.alphaHuman} hint="target" />
        </div>
      </CardContent>
    </Card>
  )
}

function MetricCell({
  label,
  value,
  hint,
}: {
  label: string
  value: number | null
  hint: string
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-medium font-mono tabular-nums">
        {value === null ? '—' : value.toFixed(4)}
      </div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-medium">{value}</div>
    </div>
  )
}

function QuestionComparison({ stats }: { stats: PerQuestionStats }) {
  const { question, matchRate, wd, llmDistribution, truthDistribution } = stats
  const options = question.options ?? []
  const isMcq = question.type === 'mcq' || question.type === 'multiple_select'

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardDescription>Q{question.qkey}</CardDescription>
            <CardTitle className="text-lg">{question.text}</CardTitle>
          </div>
          <div className="flex flex-col items-end gap-1">
            {matchRate !== null && (
              <Badge variant={matchRate >= 0.7 ? 'default' : 'outline'}>
                {Math.round(matchRate * 100)}% exact match
              </Badge>
            )}
            {wd !== null && (
              <Badge variant="outline" className="font-mono">
                WD = {wd.toFixed(4)}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isMcq && options.length > 0 && (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_auto_auto] text-xs text-muted-foreground gap-3 font-medium">
              <span>Option</span>
              <span className="text-right w-20">LLM</span>
              <span className="text-right w-20">Truth</span>
            </div>
            {options.map((opt) => {
              const llmP = llmDistribution[opt] ?? 0
              const truthP = truthDistribution[opt] ?? 0
              return (
                <div key={opt} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center text-sm">
                  <div className="truncate">{opt}</div>
                  <DistBar p={llmP} className="bg-primary/70" />
                  <DistBar p={truthP} className="bg-amber-500/70" />
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DistBar({ p, className }: { p: number; className: string }) {
  return (
    <div className="w-20 flex items-center gap-2">
      <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
        <div
          className={`h-full ${className}`}
          style={{ width: `${Math.round(p * 100)}%` }}
        />
      </div>
      <span className="text-xs font-mono tabular-nums w-9 text-right">
        {Math.round(p * 100)}%
      </span>
    </div>
  )
}

// Stats computation ----------------------------------------------------------

function buildPerQuestionStats(
  groundTruth: GroundTruthData,
  questions: Question[],
  results: SurveyResults,
): PerQuestionStats[] {
  const matches = groundTruth.matches ?? []
  // For aggregate mode, multiple match rows share a parent _id. Re-aggregate by parent.
  const respondentLookup = new Map<string, GroundTruthRespondent>()
  for (const r of groundTruth.respondents) respondentLookup.set(r._id, r)

  return questions.map((question) => {
    const options = question.options ?? []
    const llmCounts: Record<string, number> = {}
    const truthCounts: Record<string, number> = {}
    let exactMatches = 0
    let comparable = 0

    for (const match of matches) {
      const parentId = match._id.includes('::') ? match._id.split('::')[0] : match._id
      const respondent = respondentLookup.get(parentId)
      if (!respondent) continue

      const truth = respondent.answers?.[question.qkey] ?? null
      const llmResult = results[match.backstory_id] as SurveyTaskResult | undefined
      const llmRaw = llmResult?.[question.qkey]
      const llmAnswer = (llmRaw === undefined ? null : (llmRaw as string | string[])) ?? null

      if (truth !== null && llmAnswer !== null) {
        comparable += 1
        if (answersEqual(truth, llmAnswer)) exactMatches += 1
      }

      bumpCounts(llmCounts, llmAnswer)
      bumpCounts(truthCounts, truth)
    }

    const llmDistribution = normalize(llmCounts)
    const truthDistribution = normalize(truthCounts)

    let wd: number | null = null
    if (question.type === 'mcq' && options.length > 0) {
      const llmVec = alignToOptions(llmDistribution, options)
      const truthVec = alignToOptions(truthDistribution, options)
      const hasLlm = llmVec.some((v) => v > 0)
      const hasTruth = truthVec.some((v) => v > 0)
      if (hasLlm && hasTruth) wd = earthMoversDistance(llmVec, truthVec)
    }

    return {
      question,
      matchRate: comparable > 0 ? exactMatches / comparable : null,
      wd,
      llmDistribution,
      truthDistribution,
    }
  })
}

function buildRunMetrics(
  groundTruth: GroundTruthData,
  questions: Question[],
  results: SurveyResults,
  perQuestion: PerQuestionStats[],
): RunMetrics {
  const mcqQuestions = questions.filter(
    (q) => q.type === 'mcq' && (q.options?.length ?? 0) > 0,
  )

  // WD: average the per-question Wasserstein distances over MCQ questions.
  const wdVals = perQuestion
    .filter((s) => s.question.type === 'mcq' && s.wd !== null)
    .map((s) => s.wd as number)
  const wd = wdVals.length
    ? wdVals.reduce((a, b) => a + b, 0) / wdVals.length
    : null

  // Fro / alpha: build subjects x MCQ-items ordinal matrices for each population.
  const { human, llm } = buildResponseMatrices(groundTruth, mcqQuestions, results)
  const fro = frobeniusOfCorrelations(human, llm)
  const alphaHuman = cronbachAlpha(human)
  const alphaLlm = cronbachAlpha(llm)

  return {
    wd,
    fro,
    alphaHuman,
    alphaLlm,
    nSubjects: human.length,
    kQuestions: mcqQuestions.length,
  }
}

function buildResponseMatrices(
  groundTruth: GroundTruthData,
  mcqQuestions: Question[],
  results: SurveyResults,
): { human: number[][]; llm: number[][] } {
  const respondentLookup = new Map<string, GroundTruthRespondent>()
  for (const r of groundTruth.respondents) respondentLookup.set(r._id, r)

  const human: number[][] = []
  const llm: number[][] = []

  for (const match of groundTruth.matches ?? []) {
    const parentId = match._id.includes('::') ? match._id.split('::')[0] : match._id
    const respondent = respondentLookup.get(parentId)
    if (!respondent) continue
    const llmResult = results[match.backstory_id] as SurveyTaskResult | undefined

    const humanRow: number[] = []
    const llmRow: number[] = []
    for (const q of mcqQuestions) {
      const options = q.options ?? []
      humanRow.push(toOrdinal(respondent.answers?.[q.qkey] ?? null, options))
      llmRow.push(toOrdinal((llmResult?.[q.qkey] as string | string[] | undefined) ?? null, options))
    }
    human.push(humanRow)
    llm.push(llmRow)
  }

  return { human, llm }
}

function answersEqual(a: string | string[], b: string | string[]): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    const sa = [...a].sort()
    const sb = [...b].sort()
    return sa.every((v, i) => v === sb[i])
  }
  if (Array.isArray(a) || Array.isArray(b)) return false
  return a === b
}

function bumpCounts(
  counts: Record<string, number>,
  value: string | string[] | null,
): void {
  if (value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const v of value) counts[v] = (counts[v] ?? 0) + 1
  } else {
    counts[value] = (counts[value] ?? 0) + 1
  }
}

function normalize(counts: Record<string, number>): Record<string, number> {
  const total = Object.values(counts).reduce((s, v) => s + v, 0)
  if (total === 0) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(counts)) out[k] = v / total
  return out
}
