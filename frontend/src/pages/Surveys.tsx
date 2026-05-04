import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { useAuthContext } from '@/contexts/AuthContext'
import type { Survey, SurveyRun, Question, MediaAttachment, SurveyTaskResult } from '@/types/database'
import { toast } from '@/hooks/use-toast'
import { copyMedia, deleteMedia } from '@/lib/media'
import { Plus, Eye, BarChart3, Trash2, ClipboardList, Copy, LayoutGrid, List } from 'lucide-react'
import { BatchUploadDialog } from '@/components/surveys/BatchUploadDialog'
import { SurveyListTable } from '@/components/surveys/SurveyListTable'
import { BatchActionToolbar } from '@/components/surveys/BatchActionToolbar'
import { useBatchSelection } from '@/hooks/useBatchSelection'

const statusVariants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' | 'gold'> = {
  draft: 'secondary',
  active: 'gold',
  finished: 'success',
}

export function Surveys() {
  const { user, profile, maskedApiKeys } = useAuthContext()
  const [surveys, setSurveys] = useState<Survey[]>([])
  const [latestRunStatus, setLatestRunStatus] = useState<Record<string, string>>({})
  const [latestRuns, setLatestRuns] = useState<Record<string, SurveyRun>>({})
  const [runCosts, setRunCosts] = useState<Record<string, { current: number; estimated: number | null }>>({})
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem('surveys-view-mode') as 'grid' | 'list') || 'grid'
  })

  const { selectedIds, toggle, selectAll, clearSelection, selectedCount } =
    useBatchSelection<Survey>()

  useEffect(() => {
    if (user) {
      fetchSurveys()
    }
  }, [user])

  const switchViewMode = (mode: 'grid' | 'list') => {
    setViewMode(mode)
    localStorage.setItem('surveys-view-mode', mode)
    if (mode === 'grid') clearSelection()
  }

  const fetchSurveys = async () => {
    const { data, error } = await supabase
      .from('surveys')
      .select('*')
      .eq('type', 'survey')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching surveys:', error)
      setLoading(false)
      return
    }

    const fetchedSurveys = data || []
    setSurveys(fetchedSurveys)

    if (fetchedSurveys.length > 0) {
      const surveyIds = fetchedSurveys.map((s) => s.id)
      const { data: runs } = await supabase
        .from('survey_runs')
        .select('*')
        .in('survey_id', surveyIds)
        .order('created_at', { ascending: false })

      if (runs) {
        const latestByStatus: Record<string, string> = {}
        const latestByRun: Record<string, SurveyRun> = {}
        for (const run of runs as SurveyRun[]) {
          if (!latestByStatus[run.survey_id]) {
            latestByStatus[run.survey_id] = run.status
            latestByRun[run.survey_id] = run
          }
        }
        setLatestRunStatus(latestByStatus)
        setLatestRuns(latestByRun)

        // Background: aggregate cost from survey_tasks for each latest run
        const runIds = Object.values(latestByRun).map((r) => r.id)
        if (runIds.length > 0) {
          supabase
            .from('survey_tasks')
            .select('survey_run_id, result')
            .in('survey_run_id', runIds)
            .eq('status', 'completed')
            .then(({ data: taskRows }) => {
              if (!taskRows) return
              // Sum cost per run_id
              const costMap: Record<string, number> = {}
              for (const row of taskRows) {
                const cost = (row.result as SurveyTaskResult)?.__meta__?.usage?.cost ?? 0
                costMap[row.survey_run_id] = (costMap[row.survey_run_id] ?? 0) + cost
              }
              // Compute estimated total using cost-per-task × total_tasks
              const costs: Record<string, { current: number; estimated: number | null }> = {}
              for (const run of Object.values(latestByRun)) {
                const current = costMap[run.id] ?? 0
                const completed = run.completed_tasks
                const total = run.total_tasks
                const estimated =
                  completed > 0 && total > completed
                    ? (current / completed) * total
                    : null
                costs[run.survey_id] = { current, estimated }
              }
              setRunCosts(costs)
            })
        }
      }
    }

    setLoading(false)
  }

  const deleteSurvey = async (id: string) => {
    if (!confirm('Are you sure you want to delete this survey?')) return

    const survey = surveys.find((s) => s.id === id)

    const { error } = await supabase.from('surveys').delete().eq('id', id)

    if (error) {
      console.error('Error deleting survey:', error)
    } else {
      if (survey) {
        for (const q of survey.questions) {
          if (q.media?.key) deleteMedia(q.media.key)
          q.option_media?.forEach((m) => { if (m?.key) deleteMedia(m.key) })
        }
      }
      setSurveys(surveys.filter((s) => s.id !== id))
    }
  }

  const duplicateSurvey = async (survey: Survey) => {
    if (!user) return

    let copyFailed = false
    const copiedQuestions: Question[] = await Promise.all(
      survey.questions.map(async (q) => {
        try {
          const newMedia: MediaAttachment | undefined = q.media
            ? await copyMedia(q.media)
            : undefined
          const newOptionMedia = q.option_media
            ? await Promise.all(q.option_media.map((m) => (m ? copyMedia(m) : null)))
            : undefined
          return {
            ...q,
            media: newMedia,
            option_media: newOptionMedia?.length ? newOptionMedia : undefined,
          }
        } catch {
          copyFailed = true
          return { ...q, media: undefined, option_media: undefined }
        }
      })
    )

    const newSurveyData = {
      user_id: user.id,
      name: `${survey.name || 'Untitled Survey'} (Copy)`,
      questions: copiedQuestions,
      demographics: survey.demographics,
      status: 'draft',
    }

    const { data, error } = await supabase
      .from('surveys')
      .insert(newSurveyData)
      .select()
      .single()

    if (error) {
      console.error('Error duplicating survey:', error)
      toast({ title: 'Failed to copy', variant: 'destructive' })
    } else if (data) {
      setSurveys([data as Survey, ...surveys])
      toast({ title: copyFailed ? 'Copied (some media failed to copy)' : 'Copied!' })
    }
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
      <div className="space-y-8 pb-24">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Surveys</h1>
            <p className="text-muted-foreground">Create and manage your research surveys</p>
          </div>
          <div className="flex items-center gap-2">
            {surveys.length > 0 && (
              <div className="flex items-center rounded-lg border border-border p-0.5 gap-0.5">
                <Button
                  variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => switchViewMode('grid')}
                  title="Grid view"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => switchViewMode('list')}
                  title="List view"
                >
                  <List className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            <BatchUploadDialog onSurveysCreated={fetchSurveys} />
            <Link to="/surveys/new">
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                New Survey
              </Button>
            </Link>
          </div>
        </div>

        {surveys.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mb-4">
                <ClipboardList className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">No surveys yet</h3>
              <p className="text-muted-foreground text-sm mb-4 text-center max-w-sm">
                Create your first survey to start collecting responses from virtual personas.
              </p>
              <Link to="/surveys/new">
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create Your First Survey
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : viewMode === 'list' ? (
          <SurveyListTable
            surveys={surveys}
            latestRunStatus={latestRunStatus}
            latestRuns={latestRuns}
            runCosts={runCosts}
            selectedIds={selectedIds}
            onToggleSelect={toggle}
            onSelectAll={() => selectAll(surveys)}
            onClearSelection={clearSelection}
            onDeleteSurvey={deleteSurvey}
            onDuplicateSurvey={duplicateSurvey}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {surveys.map((survey) => (
              <Card key={survey.id} interactive className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base line-clamp-1">
                      <Link to={`/surveys/${survey.id}`} className="hover:underline">
                        {survey.name || 'Untitled Survey'}
                      </Link>
                    </CardTitle>
                    {(() => {
                      const displayStatus =
                        survey.status === 'active' && latestRunStatus[survey.id] === 'completed'
                          ? 'finished'
                          : survey.status
                      return (
                        <Badge variant={statusVariants[displayStatus]}>
                          {displayStatus}
                        </Badge>
                      )
                    })()}
                  </div>
                  <CardDescription className="text-xs">
                    {survey.questions.length} questions
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                  <div className="mt-auto pt-4 flex items-center gap-2 flex-wrap border-t border-border">
                    <Link to={`/surveys/${survey.id}`} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full gap-1">
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </Button>
                    </Link>
                    {survey.status === 'active' && (
                      <Link to={`/surveys/${survey.id}/results`}>
                        <Button variant="outline" size="sm" className="gap-1">
                          <BarChart3 className="h-3.5 w-3.5" />
                          Results
                        </Button>
                      </Link>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => duplicateSurvey(survey)}
                      className="px-2"
                      title="Duplicate survey"
                    >
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteSurvey(survey.id)}
                      className="px-2"
                      title="Delete survey"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>

                  <p className="text-[10px] text-muted-foreground mt-3">
                    Created {new Date(survey.created_at).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {viewMode === 'list' && selectedCount > 0 && (
        <BatchActionToolbar
          surveys={surveys}
          selectedIds={selectedIds}
          profileConfig={profile?.llm_config}
          maskedApiKeys={maskedApiKeys}
          onClearSelection={clearSelection}
          onRunsStarted={fetchSurveys}
        />
      )}
    </Layout>
  )
}
