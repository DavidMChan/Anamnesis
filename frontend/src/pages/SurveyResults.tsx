import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { supabase } from '@/lib/supabase'
import type { Survey, SurveyRun, Question, SurveyResults as SurveyResultsType } from '@/types/database'
import { ArrowLeft, Download, BarChart2, Table, ImageDown } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useRef, useCallback } from 'react'

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
  const [loading, setLoading] = useState(true)
  const chartRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    fetchData()
  }, [id, runId])

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
    calculateStats(survey, surveyRun.results)
    setLoading(false)
  }

  const calculateStats = (survey: Survey, results: SurveyResultsType) => {
    const totalResponses = Object.keys(results || {}).length

    // Map letter (A, B, C, D...) to option index
    const letterToOption = (letter: string, options: string[] | undefined): string | null => {
      if (!options) return null
      const index = letter.charCodeAt(0) - 'A'.charCodeAt(0)
      if (index >= 0 && index < options.length) {
        return options[index]
      }
      return null
    }

    const questionStats: QuestionStats[] = survey.questions.map((question) => {
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

        Object.values(results).forEach((response) => {
          const answer = response[question.qkey] as string
          if (!answer) return

          // Parse ranking: "A,C,B,D,E" or ["A", "C", "B", "D", "E"]
          const ranking = Array.isArray(answer) ? answer : answer.split(',').map(s => s.trim())

          ranking.forEach((letter, position) => {
            const optionText = letterToOption(letter, question.options)
            if (optionText) {
              // Position is 0-indexed, rank is 1-indexed
              const rank = position + 1
              rankSums[optionText] += rank
              rankCounts[optionText] += 1

              // First place count
              if (position === 0) {
                firstPlaceCounts[optionText] += 1
              }

              // Borda score: 1st place gets N points, 2nd gets N-1, etc.
              bordaScores[optionText] += (numOptions - position)
            }
          })
        })

        const rankingStats = question.options.map((opt) => ({
          option: opt,
          avgRank: rankCounts[opt] > 0 ? Math.round((rankSums[opt] / rankCounts[opt]) * 10) / 10 : 0,
          bordaScore: bordaScores[opt],
          firstPlaceCount: firstPlaceCounts[opt],
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

      Object.values(results).forEach((response) => {
        const answer = response[question.qkey]
        if (answer) {
          // Handle comma-separated answers (from multiple_select)
          const answers = typeof answer === 'string' && answer.includes(',')
            ? answer.split(',').map(s => s.trim())
            : Array.isArray(answer) ? answer : [answer]

          answers.forEach((a) => {
            const optionText = letterToOption(a, question.options) || a
            counts[optionText] = (counts[optionText] || 0) + 1
          })
        }
      })

      const distribution = Object.entries(counts).map(([option, count]) => ({
        option,
        count,
        percentage: totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0,
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

  const downloadCSV = () => {
    if (!survey || !run) return

    const results = run.results || {}
    const headers = ['backstory_id', ...survey.questions.map((q) => q.qkey)]

    const rows = Object.entries(results).map(([backstoryId, responses]) => {
      return [
        backstoryId,
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

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${survey.name || 'survey'}_results.csv`
    link.click()
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

  const results = run.results || {}
  const totalResponses = Object.keys(results).length

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/surveys/${survey.id}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold">{survey.name || 'Untitled Survey'} - Results</h1>
            <p className="text-muted-foreground">
              {totalResponses} responses • {survey.questions.length} questions
            </p>
          </div>
          <Button onClick={downloadCSV}>
            <Download className="h-4 w-4 mr-2" />
            Download CSV
          </Button>
        </div>

        <Tabs defaultValue="charts">
          <TabsList>
            <TabsTrigger value="charts">
              <BarChart2 className="h-4 w-4 mr-2" />
              Charts
            </TabsTrigger>
            <TabsTrigger value="table">
              <Table className="h-4 w-4 mr-2" />
              Table
            </TabsTrigger>
          </TabsList>

          <TabsContent value="charts" className="space-y-6 mt-6">
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
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {stat.openResponses?.slice(0, 10).map((response, i) => (
                        <div key={i} className="p-3 bg-muted rounded-md text-sm">
                          {response}
                        </div>
                      ))}
                      {(stat.openResponses?.length || 0) > 10 && (
                        <p className="text-sm text-muted-foreground">
                          ...and {(stat.openResponses?.length || 0) - 10} more responses
                        </p>
                      )}
                    </div>
                  ) : stat.question.type === 'ranking' && stat.rankingStats ? (
                    <div className="space-y-4">
                      {/* Borda Score Chart */}
                      <div>
                        <h4 className="text-sm font-medium mb-2 text-muted-foreground">
                          Borda Score (higher = more preferred)
                        </h4>
                        <div
                          className="h-48"
                          ref={(el) => { if (el) chartRefs.current.set(stat.qkey, el) }}
                        >
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={stat.rankingStats} layout="vertical">
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis type="number" />
                              <YAxis
                                type="category"
                                dataKey="option"
                                width={150}
                                tick={{ fontSize: 12 }}
                              />
                              <Tooltip
                                formatter={(value, name) => {
                                  if (name === 'bordaScore') return [`${value} points`, 'Borda Score']
                                  return [value, name]
                                }}
                              />
                              <Bar dataKey="bordaScore" radius={[0, 4, 4, 0]}>
                                {stat.rankingStats.map((_, i) => (
                                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      {/* Detailed Stats Table */}
                      <div className="border rounded-md overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted">
                            <tr>
                              <th className="text-left p-2 font-medium">Option</th>
                              <th className="text-right p-2 font-medium">Avg Rank</th>
                              <th className="text-right p-2 font-medium">Borda Score</th>
                              <th className="text-right p-2 font-medium">#1 Votes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stat.rankingStats.map((item, i) => (
                              <tr key={item.option} className="border-t">
                                <td className="p-2 flex items-center gap-2">
                                  <span
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                                  />
                                  {item.option}
                                </td>
                                <td className="text-right p-2">{item.avgRank || '-'}</td>
                                <td className="text-right p-2 font-medium">{item.bordaScore}</td>
                                <td className="text-right p-2">{item.firstPlaceCount}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="h-64"
                      ref={(el) => { if (el) chartRefs.current.set(stat.qkey, el) }}
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stat.distribution} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                          <YAxis
                            type="category"
                            dataKey="option"
                            width={150}
                            tick={{ fontSize: 12 }}
                          />
                          <Tooltip
                            formatter={(value, _name, props) => [
                              `${value}% (${(props as { payload: { count: number } }).payload.count} responses)`,
                              'Percentage'
                            ]}
                          />
                          <Bar dataKey="percentage" radius={[0, 4, 4, 0]}>
                            {stat.distribution.map((_, i) => (
                              <Cell key={i} fill={COLORS[i % COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 font-medium">Backstory ID</th>
                        {survey.questions.map((q, i) => (
                          <th key={q.qkey} className="text-left p-2 font-medium">
                            Q{i + 1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(results).slice(0, 20).map(([backstoryId, responses]) => (
                        <tr key={backstoryId} className="border-b">
                          <td className="p-2 font-mono text-xs">
                            {backstoryId.slice(0, 8)}...
                          </td>
                          {survey.questions.map((q) => (
                            <td key={q.qkey} className="p-2">
                              {Array.isArray(responses[q.qkey])
                                ? (responses[q.qkey] as string[]).join(', ')
                                : (responses[q.qkey] as string) || '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {Object.keys(results).length > 20 && (
                    <p className="text-sm text-muted-foreground mt-4">
                      Showing 20 of {Object.keys(results).length} responses. Download CSV for full data.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  )
}
