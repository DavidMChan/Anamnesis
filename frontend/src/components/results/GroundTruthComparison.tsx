/**
 * Ground Truth comparison view.
 *
 * Renders per-question LLM-vs-ground-truth comparisons for a Ground Truth run.
 * For each MCQ-style question it shows side-by-side distributions and the
 * Jensen-Shannon divergence. For open-response it lists matched pairs.
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
import { Target } from 'lucide-react'

interface ComparisonProps {
  groundTruth: GroundTruthData
  questions: Question[]
  results: SurveyResults
}

interface ComparisonPair {
  respondentId: string
  groundTruth: string | string[] | null
  llmAnswer: string | string[] | null
  matchScore: number
}

interface PerQuestionStats {
  question: Question
  pairs: ComparisonPair[]
  matchRate: number | null
  jsDivergence: number | null
  llmDistribution: Record<string, number>
  truthDistribution: Record<string, number>
}

export function GroundTruthComparison({ groundTruth, questions, results }: ComparisonProps) {
  const stats = useMemo(
    () => buildComparisonStats(groundTruth, questions, results),
    [groundTruth, questions, results],
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
      {stats
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

function StatCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-medium">{value}</div>
    </div>
  )
}

function QuestionComparison({ stats }: { stats: PerQuestionStats }) {
  const { question, pairs, matchRate, jsDivergence, llmDistribution, truthDistribution } = stats
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
            {jsDivergence !== null && (
              <Badge variant="outline" className="font-mono">
                JS = {jsDivergence.toFixed(4)}
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

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Show all {pairs.length} pairs
          </summary>
          <div className="mt-2 max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-1">Respondent</th>
                  <th className="text-left p-1">Ground truth</th>
                  <th className="text-left p-1">LLM answer</th>
                  <th className="text-right p-1">Match score</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => (
                  <tr key={p.respondentId} className="border-b last:border-0">
                    <td className="p-1 font-mono">{p.respondentId}</td>
                    <td className="p-1">{renderAnswer(p.groundTruth)}</td>
                    <td className="p-1">{renderAnswer(p.llmAnswer)}</td>
                    <td className="p-1 text-right font-mono">
                      {p.matchScore.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
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

function renderAnswer(value: string | string[] | null): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.join(', ')
  return value
}

// Stats computation ----------------------------------------------------------

function buildComparisonStats(
  groundTruth: GroundTruthData,
  questions: Question[],
  results: SurveyResults,
): PerQuestionStats[] {
  const matches = groundTruth.matches ?? []
  // For aggregate mode, multiple match rows share a parent _id. Re-aggregate by parent.
  const respondentLookup = new Map<string, GroundTruthRespondent>()
  for (const r of groundTruth.respondents) respondentLookup.set(r._id, r)

  return questions.map((question) => {
    const pairs: ComparisonPair[] = []
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

      pairs.push({
        respondentId: match._id,
        groundTruth: truth,
        llmAnswer,
        matchScore: match.score,
      })

      if (truth !== null && llmAnswer !== null) {
        comparable += 1
        if (answersEqual(truth, llmAnswer)) exactMatches += 1
      }

      bumpCounts(llmCounts, llmAnswer)
      bumpCounts(truthCounts, truth)
    }

    const llmDistribution = normalize(llmCounts)
    const truthDistribution = normalize(truthCounts)

    let jsDivergence: number | null = null
    if (
      (question.type === 'mcq' || question.type === 'multiple_select') &&
      Object.keys(llmDistribution).length > 0 &&
      Object.keys(truthDistribution).length > 0
    ) {
      jsDivergence = jensenShannon(llmDistribution, truthDistribution)
    }

    return {
      question,
      pairs,
      matchRate: comparable > 0 ? exactMatches / comparable : null,
      jsDivergence,
      llmDistribution,
      truthDistribution,
    }
  })
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

function jensenShannon(
  p: Record<string, number>,
  q: Record<string, number>,
): number {
  const keys = new Set([...Object.keys(p), ...Object.keys(q)])
  let js = 0
  for (const k of keys) {
    const pk = p[k] ?? 0
    const qk = q[k] ?? 0
    const m = 0.5 * (pk + qk)
    if (pk > 0) js += 0.5 * pk * Math.log2(pk / m)
    if (qk > 0) js += 0.5 * qk * Math.log2(qk / m)
  }
  // Round-off correction
  return Math.max(0, js)
}
