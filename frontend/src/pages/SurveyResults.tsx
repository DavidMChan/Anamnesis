import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { supabase } from '@/lib/supabase'
import type { Survey, Question, SurveyResults as SurveyResultsType } from '@/types/database'
import { ArrowLeft, Download, BarChart2, Table } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

interface QuestionStats {
  qkey: string
  question: Question
  distribution: { option: string; count: number; percentage: number }[]
  openResponses?: string[]
}

export function SurveyResults() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [stats, setStats] = useState<QuestionStats[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchSurvey()
  }, [id])

  const fetchSurvey = async () => {
    if (!id) return
    const { data, error } = await supabase
      .from('surveys')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      console.error('Error fetching survey:', error)
      navigate('/surveys')
    } else if (data) {
      const surveyData = data as Survey
      setSurvey(surveyData)
      calculateStats(surveyData)
    }
    setLoading(false)
  }

  const calculateStats = (survey: Survey) => {
    const results = survey.results as SurveyResultsType
    const totalResponses = Object.keys(results).length

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

      const counts: Record<string, number> = {}

      if (question.options) {
        question.options.forEach((opt) => {
          counts[opt] = 0
        })
      }

      Object.values(results).forEach((response) => {
        const answer = response[question.qkey]
        if (answer) {
          if (Array.isArray(answer)) {
            answer.forEach((a) => {
              counts[a] = (counts[a] || 0) + 1
            })
          } else {
            counts[answer] = (counts[answer] || 0) + 1
          }
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

  const downloadCSV = () => {
    if (!survey) return

    const results = survey.results as SurveyResultsType
    const headers = ['backstory_id', ...survey.questions.map((q) => q.qkey)]

    const rows = Object.entries(results).map(([backstoryId, responses]) => {
      return [
        backstoryId,
        ...survey.questions.map((q) => {
          const answer = responses[q.qkey]
          if (Array.isArray(answer)) {
            return answer.join('; ')
          }
          return answer || ''
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

  if (!survey) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Survey not found</p>
        </div>
      </Layout>
    )
  }

  const totalResponses = Object.keys(survey.results).length

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
                  <CardDescription>Q{index + 1}</CardDescription>
                  <CardTitle className="text-lg">{stat.question.text}</CardTitle>
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
                  ) : (
                    <div className="h-64">
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
                      {Object.entries(survey.results).slice(0, 20).map(([backstoryId, responses]) => (
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
                  {Object.keys(survey.results).length > 20 && (
                    <p className="text-sm text-muted-foreground mt-4">
                      Showing 20 of {Object.keys(survey.results).length} responses. Download CSV for full data.
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
