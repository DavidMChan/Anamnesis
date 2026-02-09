import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { supabase } from '@/lib/supabase'
import type { Survey } from '@/types/database'
import { ArrowLeft, Edit, Play, BarChart2, RefreshCw } from 'lucide-react'

const statusColors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'secondary',
  queued: 'outline',
  running: 'default',
  completed: 'default',
  failed: 'destructive',
}

const questionTypeLabels: Record<string, string> = {
  mcq: 'Multiple Choice',
  multiple_select: 'Multi-Select',
  open_response: 'Open Response',
  ranking: 'Ranking',
}

export function SurveyView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchSurvey()
    // Poll for updates if running
    const interval = setInterval(() => {
      if (survey?.status === 'running' || survey?.status === 'queued') {
        fetchSurvey()
      }
    }, 5000)

    return () => clearInterval(interval)
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
    } else {
      setSurvey(data as Survey)
    }
    setLoading(false)
  }

  const runSurvey = async () => {
    if (!survey) return

    const { error } = await supabase
      .from('surveys')
      .update({ status: 'queued' } as Record<string, unknown>)
      .eq('id', survey.id)

    if (!error) {
      fetchSurvey()
    }
  }

  const getProgress = () => {
    if (!survey?.matched_count || survey.matched_count === 0) return 0
    return Math.round(((survey.completed_count || 0) / survey.matched_count) * 100)
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

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/surveys')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">{survey.name || 'Untitled Survey'}</h1>
              <Badge variant={statusColors[survey.status]}>
                {survey.status.charAt(0).toUpperCase() + survey.status.slice(1)}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              {survey.questions.length} questions • Created {new Date(survey.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex gap-2">
            {survey.status === 'draft' && (
              <>
                <Link to={`/surveys/${survey.id}/edit`}>
                  <Button variant="outline">
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                </Link>
                <Button onClick={runSurvey}>
                  <Play className="h-4 w-4 mr-2" />
                  Run Survey
                </Button>
              </>
            )}
            {survey.status === 'completed' && (
              <Link to={`/surveys/${survey.id}/results`}>
                <Button>
                  <BarChart2 className="h-4 w-4 mr-2" />
                  View Results
                </Button>
              </Link>
            )}
          </div>
        </div>

        {(survey.status === 'running' || survey.status === 'queued') && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Survey in Progress
              </CardTitle>
              <CardDescription>
                Processing {survey.matched_count || 0} backstories
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Progress</span>
                  <span>{survey.completed_count || 0} / {survey.matched_count || 0} ({getProgress()}%)</span>
                </div>
                <Progress value={getProgress()} />
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Questions</CardTitle>
            <CardDescription>
              {survey.questions.length} questions in this survey
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {survey.questions.map((question, index) => (
                <div key={question.qkey} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-sm font-medium text-muted-foreground">
                      Q{index + 1}
                    </span>
                    <Badge variant="outline">
                      {questionTypeLabels[question.type]}
                    </Badge>
                  </div>
                  <p className="font-medium mb-2">{question.text}</p>
                  {question.options && question.options.length > 0 && (
                    <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                      {question.options.map((option, optIndex) => (
                        <li key={optIndex}>
                          {question.type === 'ranking' ? `${optIndex + 1}. ` : '• '}
                          {option}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Demographic Filters</CardTitle>
            <CardDescription>
              Target audience for this survey
            </CardDescription>
          </CardHeader>
          <CardContent>
            {Object.keys(survey.demographics).length === 0 ? (
              <p className="text-muted-foreground">No demographic filters applied (all backstories)</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(survey.demographics).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="font-medium capitalize">{key.replace('_', ' ')}:</span>
                    <span className="text-muted-foreground">
                      {Array.isArray(value) ? value.join(', ') : JSON.stringify(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  )
}
