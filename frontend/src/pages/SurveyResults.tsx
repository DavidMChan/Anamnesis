import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { supabase } from '@/lib/supabase'
import { useSurveyRun } from '@/hooks/useSurveyRun'
import type { Survey, SurveyRun, Question, SurveyResults as SurveyResultsType } from '@/types/database'
import { getModelName } from '@/lib/llmConfig'
import { BarChart2, Table, ImageDown, RefreshCw, ChevronDown, Settings } from 'lucide-react'
import { ResultsHero } from '@/components/results/ResultsHero'
import { OpenResponseList } from '@/components/results/OpenResponseList'
import { DistributionChart } from '@/components/results/DistributionChart'
import { RankingResults } from '@/components/results/RankingResults'
import { ResultsTable } from '@/components/results/ResultsTable'
import { DemographicsSummary } from '@/components/results/DemographicsSummary'
import { DemographicFilter } from '@/components/results/DemographicFilter'
import type { Backstory, DemographicKey } from '@/types/database'

// Chart colors (vibrant for data visualization)
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

// BAIR Lab color palette (for future use)
// const BAIR_COLORS = [
//   '#003262', // BAIR dark blue (primary)
//   '#3B7EA1', // BAIR medium blue
//   '#00B0DA', // Berkeley bright blue
//   '#CFDD45', // Berkeley chartreuse
//   '#6C3302', // Berkeley brown
//   '#DDD5C7', // Berkeley sandstone
//   '#FDB515', // Berkeley gold
//   '#C4820E', // BAIR gold accent
// ]

function RunConfigCard({ run }: { run: SurveyRun | null }) {
  const [expanded, setExpanded] = useState(false)

  if (!run) return null

  const config = run.llm_config
  const modelName = getModelName(config)

  return (
    <Card>
      <button
        type="button"
        className="flex items-center justify-between w-full px-6 py-4 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4" />
          <span className="text-base font-semibold leading-none tracking-tight">Run Configuration</span>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <CardContent className="pt-0 pb-4">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium w-24">Algorithm:</span>
              <Badge variant="outline">
                {run.algorithm === 'zero_shot_baseline' ? 'Zero-Shot Baseline' : 'Anthology'}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium w-24">Provider:</span>
              <Badge variant="outline">{config.provider || 'Not set'}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium w-24">Model:</span>
              <span className="text-muted-foreground font-mono text-xs">{modelName || 'Not set'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium w-24">Temperature:</span>
              <span className="text-muted-foreground">{config.temperature ?? 'Not set'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium w-24">Max Tokens:</span>
              <span className="text-muted-foreground">{config.max_tokens ?? 'Not set'}</span>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}

interface QuestionStats {
  qkey: string
  question: Question
  distribution: { option: string; count: number; percentage: number }[]
  openResponses?: string[]
  // Ranking-specific stats
  rankingStats?: {
    option: string
    avgRank: number
    bordaScore: number
    firstPlaceCount: number
  }[]
}

export function SurveyResults() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const runId = searchParams.get('run')
  const navigate = useNavigate()
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [run, setRun] = useState<SurveyRun | null>(null)
  const [stats, setStats] = useState<QuestionStats[]>([])
  const [results, setResults] = useState<SurveyResultsType>({})
  const [loading, setLoading] = useState(true)

  // Track run status for auto-polling
  const { run: trackedRun, isRunning } = useSurveyRun({
    runId: runId || undefined,
    autoPoll: true,
    pollInterval: 3000,
  })

  // Demographic filtering state
  const [backstories, setBackstories] = useState<Backstory[] | null>(null)
  const [demographicKeys, setDemographicKeys] = useState<DemographicKey[] | null>(null)
  const [selectedFilters, setSelectedFilters] = useState<{ key: string; value: string }[]>([])
  const [loadingDemographics, setLoadingDemographics] = useState(false)
  const [downloadingCSV, setDownloadingCSV] = useState(false)
  const chartRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    if (survey && Object.keys(results).length > 0 && backstories) {
      calculateStats(survey, results, selectedFilters)
    }
  }, [backstories])

  useEffect(() => {
    fetchData()
  }, [id, runId])

  // Auto-refresh task results while run is in progress
  useEffect(() => {
    if (!isRunning || !run) return
    const interval = setInterval(() => refetchTaskResults(), 5000)
    return () => clearInterval(interval)
  }, [isRunning, run?.id])

  // Update run status from tracked run
  useEffect(() => {
    if (trackedRun) {
      setRun(trackedRun)
    }
  }, [trackedRun])

  const fetchData = async () => {
    if (!id) return

    // Fetch survey
    const { data: surveyData, error: surveyError } = await supabase
      .from('surveys')
      .select('*')
      .eq('id', id)
      .single()

    if (surveyError) {
      console.error('Error fetching survey:', surveyError)
      navigate('/surveys')
      return
    }

    const survey = surveyData as Survey
    setSurvey(survey)

    // Fetch run - either specific run or latest
    let runQuery = supabase
      .from('survey_runs')
      .select('*')

    if (runId) {
      runQuery = runQuery.eq('id', runId)
    } else {
      runQuery = runQuery
        .eq('survey_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
    }

    const { data: runData, error: runError } = await runQuery.single()

    if (runError) {
      console.error('Error fetching run:', runError)
      setLoading(false)
      return
    }

    const surveyRun = runData as SurveyRun
    setRun(surveyRun)

    // Fetch results from survey_tasks (source of truth)
    const { data: tasksData, error: tasksError } = await supabase
      .from('survey_tasks')
      .select('id, backstory_id, result')
      .eq('survey_run_id', surveyRun.id)
      .eq('status', 'completed')

    if (tasksError) {
      console.error('Error fetching task results:', tasksError)
      setLoading(false)
      return
    }

    const taskResults: SurveyResultsType = {}
    for (const task of tasksData || []) {
      if (task.result) {
        // For zero_shot_baseline runs, backstory_id is null — key by task.id instead
        taskResults[task.backstory_id ?? task.id] = task.result
      }
    }
    setResults(taskResults)

    // Fetch demographic keys immediately
    const { data: keysData } = await supabase
      .from('demographic_keys')
      .select('*')

    if (keysData) {
      setDemographicKeys(keysData as DemographicKey[])
    }

    calculateStats(survey, taskResults, [])

    setLoading(false)
  }

  const refetchTaskResults = async () => {
    if (!run || !survey) return

    const { data: tasksData, error: tasksError } = await supabase
      .from('survey_tasks')
      .select('id, backstory_id, result')
      .eq('survey_run_id', run.id)
      .eq('status', 'completed')

    if (tasksError) return

    const taskResults: SurveyResultsType = {}
    for (const task of tasksData || []) {
      if (task.result) {
        taskResults[task.backstory_id ?? task.id] = task.result
      }
    }
    setResults(taskResults)
    calculateStats(survey, taskResults, selectedFilters)
  }

  const fetchDemographics = async () => {
    if (backstories) return
    if (Object.keys(results).length === 0) return

    setLoadingDemographics(true)
    try {
      const backstoryIds = Object.keys(results)

      // If there are many backstories, fetching by "in" can be slow.
      // We'll batch the requests to be safer and potentially faster than one giant "in".
      const BATCH_SIZE = 100
      let allBackstories: Backstory[] = []

      for (let i = 0; i < backstoryIds.length; i += BATCH_SIZE) {
        const batchIds = backstoryIds.slice(i, i + BATCH_SIZE)
        const { data, error } = await supabase
          .from('backstories')
          .select('*')
          .in('id', batchIds)

        if (error) throw error
        if (data) {
          allBackstories = [...allBackstories, ...(data as Backstory[])]
        }
      }

      setBackstories(allBackstories)
    } catch (error) {
      console.error('Error fetching demographics:', error)
    } finally {
      setLoadingDemographics(false)
    }
  }

  const calculateStats = (
    survey: Survey,
    results: SurveyResultsType,
    filters: { key: string; value: string }[]
  ) => {
    const backstoryEntries = Object.entries(results || {})

    // Map of backstory ID to weight
    const weights: Record<string, number> = {}
    let totalWeight = 0

    backstoryEntries.forEach(([backstoryId, _]) => {
      let weight = 1.0

      if (filters.length > 0 && backstories) {
        const backstory = backstories.find(b => b.id === backstoryId)

        for (const filter of filters) {
          const demoData = backstory?.demographics?.[filter.key]
          let filterWeight = 0

          if (demoData?.distribution) {
            filterWeight = demoData.distribution[filter.value] ?? 0
          } else if (demoData?.value === filter.value) {
            filterWeight = 1.0
          }

          weight *= filterWeight
          if (weight === 0) break // Short circuit if any weight is 0
        }
      }

      weights[backstoryId] = weight
      totalWeight += weight
    })

    const questionStats: QuestionStats[] = survey.questions.map((question) => {
      // Map letter (A, B, C, D...) to option index
      const letterToOption = (letter: string, options: string[] | undefined): string | null => {
        if (!options) return null
        const index = letter.charCodeAt(0) - 'A'.charCodeAt(0)
        if (index >= 0 && index < options.length) {
          return options[index]
        }
        return null
      }

      if (question.type === 'open_response') {
        const openResponses = Object.values(results)
          .map((r) => r[question.qkey] as string)
          .filter(Boolean)

        return {
          qkey: question.qkey,
          question,
          distribution: [],
          openResponses,
        }
      }

      // Handle ranking questions specially
      if (question.type === 'ranking' && question.options) {
        const numOptions = question.options.length
        const rankSums: Record<string, number> = {}
        const rankCounts: Record<string, number> = {}
        const firstPlaceCounts: Record<string, number> = {}
        const bordaScores: Record<string, number> = {}

        // Initialize
        question.options.forEach((opt) => {
          rankSums[opt] = 0
          rankCounts[opt] = 0
          firstPlaceCounts[opt] = 0
          bordaScores[opt] = 0
        })

        Object.entries(results).forEach(([backstoryId, response]) => {
          const weight = weights[backstoryId]
          if (weight <= 0) return

          const answer = response[question.qkey] as string
          if (!answer) return

          // Parse ranking: "A,C,B,D,E" or ["A", "C", "B", "D", "E"]
          const ranking = Array.isArray(answer) ? answer : answer.split(',').map(s => s.trim())

          ranking.forEach((letter, position) => {
            const optionText = letterToOption(letter, question.options)
            if (optionText) {
              // Position is 0-indexed, rank is 1-indexed
              const rank = position + 1
              rankSums[optionText] += rank * weight
              rankCounts[optionText] += weight

              // First place count
              if (position === 0) {
                firstPlaceCounts[optionText] += weight
              }

              // Borda score: 1st place gets N points, 2nd gets N-1, etc.
              bordaScores[optionText] += (numOptions - position) * weight
            }
          })
        })

        const rankingStats = question.options.map((opt) => ({
          option: opt,
          avgRank: rankCounts[opt] > 0 ? Math.round((rankSums[opt] / rankCounts[opt]) * 10) / 10 : 0,
          bordaScore: Math.round(bordaScores[opt] * 10) / 10,
          firstPlaceCount: Math.round(firstPlaceCounts[opt] * 10) / 10,
        }))

        // Sort by Borda score (higher is better)
        rankingStats.sort((a, b) => b.bordaScore - a.bordaScore)

        return {
          qkey: question.qkey,
          question,
          distribution: [],
          rankingStats,
        }
      }

      // MCQ and multiple_select
      const counts: Record<string, number> = {}

      // Initialize counts with option text
      if (question.options) {
        question.options.forEach((opt) => {
          counts[opt] = 0
        })
      }

      Object.entries(results).forEach(([backstoryId, response]) => {
        const weight = weights[backstoryId]
        if (weight <= 0) return

        const answer = response[question.qkey]
        if (answer) {
          // Handle comma-separated answers (from multiple_select)
          const answers = typeof answer === 'string' && answer.includes(',')
            ? answer.split(',').map(s => s.trim())
            : Array.isArray(answer) ? answer : [answer]

          answers.forEach((a) => {
            const optionText = letterToOption(a, question.options) || a
            counts[optionText] = (counts[optionText] || 0) + weight
          })
        }
      })

      const distribution = Object.entries(counts).map(([option, count]) => ({
        option,
        count: Math.round(count * 10) / 10,
        percentage: totalWeight > 0 ? Math.round((count / totalWeight) * 100) : 0,
      }))

      return {
        qkey: question.qkey,
        question,
        distribution,
      }
    })

    setStats(questionStats)
  }

  // Download chart as PNG
  const downloadChart = useCallback((qkey: string, questionText: string) => {
    const chartContainer = chartRefs.current.get(qkey)
    if (!chartContainer) return

    const svgElement = chartContainer.querySelector('svg')
    if (!svgElement) return

    // Clone SVG and add white background
    const svgClone = svgElement.cloneNode(true) as SVGElement
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

    // Add white background rect
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bgRect.setAttribute('width', '100%')
    bgRect.setAttribute('height', '100%')
    bgRect.setAttribute('fill', 'white')
    svgClone.insertBefore(bgRect, svgClone.firstChild)

    // Convert to data URL
    const svgData = new XMLSerializer().serializeToString(svgClone)
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const svgUrl = URL.createObjectURL(svgBlob)

    // Create canvas and draw
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const scale = 2 // Higher resolution
      canvas.width = img.width * scale
      canvas.height = img.height * scale

      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.scale(scale, scale)
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, img.width, img.height)
        ctx.drawImage(img, 0, 0)

        // Download
        const link = document.createElement('a')
        link.download = `${questionText.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '_')}.png`
        link.href = canvas.toDataURL('image/png')
        link.click()
      }
      URL.revokeObjectURL(svgUrl)
    }
    img.src = svgUrl
  }, [])

  // Helper to map letter answer to option text
  const mapAnswerToOption = (answer: string, question: Question): string => {
    if (!question.options || question.type === 'open_response') return answer
    const index = answer.charCodeAt(0) - 'A'.charCodeAt(0)
    if (index >= 0 && index < question.options.length) {
      return question.options[index]
    }
    return answer
  }

  const downloadCSV = async () => {
    if (!survey || !run || downloadingCSV) return
    setDownloadingCSV(true)

    const isZeroShot = run.algorithm === 'zero_shot_baseline'

    // Fetch backstory demographics via RPC (single query with temp table join)
    // Only relevant for anthology runs (zero_shot has no backstories)
    let backstoryMap: Map<string, Record<string, unknown>> = new Map()
    if (!isZeroShot) {
      const backstoryIds = Object.keys(results)
      if (backstoryIds.length > 0) {
        const { data } = await supabase.rpc('get_backstory_demographics', {
          backstory_ids: backstoryIds,
        })
        if (data) {
          backstoryMap = new Map(
            (data as { id: string; demographics: Record<string, unknown> }[]).map((b) => [b.id, b.demographics])
          )
        }
      }
    }

    const questionHeaders = survey.questions.map((q) => `${q.qkey}: ${q.text}`)
    const firstCol = isZeroShot ? 'trial_index' : 'backstory_id'
    const headers = isZeroShot
      ? [firstCol, ...questionHeaders]
      : [firstCol, 'demographics', ...questionHeaders]

    const rows = Object.entries(results).map(([backstoryId, responses], index) => {
      const firstColValue = isZeroShot ? `Trial ${index + 1}` : backstoryId
      const demographics = backstoryMap.get(backstoryId)
      const demographicsStr = demographics ? JSON.stringify(demographics) : ''

      return [
        firstColValue,
        ...(isZeroShot ? [] : [demographicsStr]),
        ...survey.questions.map((q) => {
          const answer = responses[q.qkey]
          if (!answer) return ''

          // Handle ranking: "A,C,B,D,E" -> "Taiwan > China > United States > Italy > Mexico"
          if (q.type === 'ranking' && typeof answer === 'string' && q.options) {
            const ranking = answer.split(',').map(s => s.trim())
            return ranking
              .map((letter) => {
                const index = letter.charCodeAt(0) - 'A'.charCodeAt(0)
                return q.options && index >= 0 && index < q.options.length
                  ? q.options[index]
                  : letter
              })
              .join(' > ')
          }

          // Handle multiple select and arrays
          if (Array.isArray(answer)) {
            return answer.map((a) => mapAnswerToOption(a, q)).join('; ')
          }

          // Handle comma-separated (multiple_select stored as string)
          if (typeof answer === 'string' && answer.includes(',') && q.type === 'multiple_select') {
            return answer
              .split(',')
              .map(s => mapAnswerToOption(s.trim(), q))
              .join('; ')
          }

          return mapAnswerToOption(answer, q)
        }),
      ]
    })

    const escape = (cell: string) => `"${cell.replace(/"/g, '""')}"`
    const csvContent = [
      headers.map(escape).join(','),
      ...rows.map((row) => row.map((cell) => escape(String(cell))).join(',')),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    const sampleSize = Object.keys(results).length
    const slugName = (survey.name || 'survey').replace(/\s+/g, '_')
    link.download = `${slugName}_${run.algorithm}_sample_${sampleSize}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setDownloadingCSV(false)
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </Layout>
    )
  }

  if (!survey || !run) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {!survey ? 'Survey not found' : 'No results available yet'}
          </p>
        </div>
      </Layout>
    )
  }

  const totalResponses = Object.keys(results).length

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <ResultsHero
          survey={survey}
          run={run}
          totalResponses={totalResponses}
          onBack={() => navigate(`/surveys/${survey.id}`)}
          onDownloadCSV={downloadCSV}
          isDownloadingCSV={downloadingCSV}
        />

        <RunConfigCard run={run} />

        {isRunning && run && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm text-foreground">
              Showing {totalResponses} / {run.total_tasks} completed responses — auto-refreshing
            </span>
            <Badge variant="outline" className="ml-auto">
              Partial
            </Badge>
          </div>
        )}

        <Tabs defaultValue="charts">
          <TabsList>
            <TabsTrigger value="charts">
              <BarChart2 className="h-4 w-4 mr-2" />
              Charts
            </TabsTrigger>
            <TabsTrigger value="demographics">
              <Table className="h-4 w-4 mr-2" />
              Demographics
            </TabsTrigger>
            <TabsTrigger value="table">
              <Table className="h-4 w-4 mr-2" />
              Table
            </TabsTrigger>
          </TabsList>

          <TabsContent value="charts" className="space-y-6 mt-6">
            <DemographicFilter
              demographicKeys={demographicKeys}
              selectedFilters={selectedFilters}
              onFiltersChange={(filters) => {
                setSelectedFilters(filters)
                if (survey) {
                  calculateStats(survey, results, filters)
                }
              }}
              onTriggerFetch={fetchDemographics}
              isLoading={loadingDemographics}
            />

            {stats.map((stat, index) => (
              <Card key={stat.qkey}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardDescription>Q{index + 1}</CardDescription>
                      <CardTitle className="text-lg">{stat.question.text}</CardTitle>
                    </div>
                    {stat.question.type !== 'open_response' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadChart(stat.qkey, stat.question.text)}
                        title="Download chart as PNG"
                      >
                        <ImageDown className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {stat.question.type === 'open_response' ? (
                    <OpenResponseList responses={stat.openResponses} />
                  ) : stat.question.type === 'ranking' && stat.rankingStats ? (
                    <RankingResults
                      rankingStats={stat.rankingStats}
                      colors={COLORS}
                      onRef={(el) => { if (el) chartRefs.current.set(stat.qkey, el) }}
                    />
                  ) : (
                    <DistributionChart
                      distribution={stat.distribution}
                      colors={COLORS}
                      onRef={(el) => { if (el) chartRefs.current.set(stat.qkey, el) }}
                    />
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="demographics" className="mt-6">
            <DemographicsSummary backstoryIds={Object.keys(results)} colors={COLORS} />
          </TabsContent>

          <TabsContent value="table" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Response Data</CardTitle>
                <CardDescription>
                  Raw response data for all {totalResponses} backstories
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResultsTable survey={survey} results={results} algorithm={run.algorithm} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  )
}
