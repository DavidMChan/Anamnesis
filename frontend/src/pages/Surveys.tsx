import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { supabase } from '@/lib/supabase'
import { useAuthContext } from '@/contexts/AuthContext'
import type { Survey } from '@/types/database'
import { Plus, Eye, Download, Trash2 } from 'lucide-react'

const statusColors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'secondary',
  queued: 'outline',
  running: 'default',
  completed: 'default',
  failed: 'destructive',
}

export function Surveys() {
  const { user } = useAuthContext()
  const [surveys, setSurveys] = useState<Survey[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user) {
      fetchSurveys()
    }
  }, [user])

  const fetchSurveys = async () => {
    const { data, error } = await supabase
      .from('surveys')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching surveys:', error)
    } else {
      setSurveys(data || [])
    }
    setLoading(false)
  }

  const deleteSurvey = async (id: string) => {
    if (!confirm('Are you sure you want to delete this survey?')) return

    const { error } = await supabase.from('surveys').delete().eq('id', id)

    if (error) {
      console.error('Error deleting survey:', error)
    } else {
      setSurveys(surveys.filter((s) => s.id !== id))
    }
  }

  const getProgress = (survey: Survey) => {
    if (!survey.matched_count || survey.matched_count === 0) return 0
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

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">My Surveys</h1>
            <p className="text-muted-foreground">Create and manage your surveys</p>
          </div>
          <Link to="/surveys/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Survey
            </Button>
          </Link>
        </div>

        {surveys.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <p className="text-muted-foreground mb-4">You haven't created any surveys yet.</p>
              <Link to="/surveys/new">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Survey
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {surveys.map((survey) => (
              <Card key={survey.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">
                        {survey.name || 'Untitled Survey'}
                      </CardTitle>
                      <CardDescription>
                        {survey.questions.length} questions
                        {survey.matched_count ? ` • ${survey.matched_count} backstories` : ''}
                      </CardDescription>
                    </div>
                    <Badge variant={statusColors[survey.status]}>
                      {survey.status.charAt(0).toUpperCase() + survey.status.slice(1)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {(survey.status === 'running' || survey.status === 'queued') && (
                    <div className="mb-4">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span>Progress</span>
                        <span>{getProgress(survey)}%</span>
                      </div>
                      <Progress value={getProgress(survey)} />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Link to={`/surveys/${survey.id}`}>
                      <Button variant="outline" size="sm">
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
                    </Link>
                    {survey.status === 'completed' && (
                      <Link to={`/surveys/${survey.id}/results`}>
                        <Button variant="outline" size="sm">
                          <Download className="h-4 w-4 mr-1" />
                          Results
                        </Button>
                      </Link>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteSurvey(survey.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                    <span className="text-xs text-muted-foreground ml-auto">
                      Created {new Date(survey.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
