import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { useSurveyRun } from '@/hooks/useSurveyRun'
import { SurveyRunProgress, SurveyRunHistory } from '@/components/surveys/SurveyRunProgress'
import { cancelSurveyRun } from '@/lib/surveyRunner'
import type { Survey, SurveyRun, DemographicKey, DemographicKeyStatus } from '@/types/database'
import { ArrowLeft, History } from 'lucide-react'

const statusVariants: Record<DemographicKeyStatus, 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' | 'gold'> = {
  pending: 'outline',
  running: 'info',
  finished: 'gold',
  failed: 'destructive',
}

export function DemographicSurveyView() {
  const { id } = useParams() // survey_id
  const navigate = useNavigate()
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [demographicKey, setDemographicKey] = useState<DemographicKey | null>(null)
  const [loading, setLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [selectedRun, setSelectedRun] = useState<SurveyRun | null>(null)

  const { run: latestRun, runs, isRunning, refresh: refreshRuns } = useSurveyRun({
    surveyId: id,
    autoPoll: true,
    pollInterval: 3000,
  })

  useEffect(() => {
    fetchData()
  }, [id])

  // Refresh demographic key status when run completes
  useEffect(() => {
    if (latestRun && !isRunning && demographicKey?.status === 'running') {
      fetchDemographicKey(survey?.demographic_key)
    }
  }, [latestRun?.status])

  const fetchData = async () => {
    if (!id) return

    const { data: surveyData, error: surveyError } = await supabase
      .from('surveys')
      .select('*')
      .eq('id', id)
      .single()

    if (surveyError) {
      console.error('Error fetching survey:', surveyError)
      navigate('/demographic-surveys')
      return
    }

    const s = surveyData as Survey
    setSurvey(s)

    // Fetch the associated demographic key by slug
    if (s.demographic_key) {
      await fetchDemographicKey(s.demographic_key)
    }

    setLoading(false)
  }

  const fetchDemographicKey = async (keySlug?: string | null) => {
    if (!keySlug) return
    const { data } = await supabase
      .from('demographic_keys')
      .select('*')
      .eq('key', keySlug)
      .single()

    if (data) {
      setDemographicKey(data as DemographicKey)
    }
  }

  const displayRun = selectedRun || latestRun

  // Get distribution_mode/num_trials from the latest run's llm_config
  const runConfig = latestRun?.llm_config
  const distributionMode = runConfig?.distribution_mode || 'n_sample'
  const numTrials = runConfig?.num_trials || 20

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

  const question = survey.questions[0]

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/demographic-surveys')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">
                {demographicKey?.display_name || survey.name}
              </h1>
              {demographicKey && (
                <Badge variant={statusVariants[demographicKey.status]}>
                  {demographicKey.status}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">
              <span className="font-mono">{survey.demographic_key}</span>
              {' · '}
              {`${demographicKey?.enum_values?.length || 0} values`}
              {' · '}
              {distributionMode === 'n_sample'
                ? `${numTrials} trials per backstory`
                : 'logprobs mode'}
              {runs.length > 0 && ` · ${runs.length} run${runs.length > 1 ? 's' : ''}`}
            </p>
          </div>
          {runs.length > 1 && (
            <Button variant="outline" onClick={() => setShowHistory(!showHistory)}>
              <History className="h-4 w-4 mr-2" />
              History
            </Button>
          )}
        </div>

        {/* Run Progress */}
        {displayRun && (
          <SurveyRunProgress
            run={displayRun}
            onCancel={async () => {
              await cancelSurveyRun(displayRun.id)
              refreshRuns()
            }}
          />
        )}

        {/* Run History */}
        {showHistory && runs.length > 0 && (
          <SurveyRunHistory
            runs={runs}
            onSelectRun={(run) => {
              setSelectedRun(run)
              setShowHistory(false)
            }}
          />
        )}

        {/* Question Details */}
        {question && (
          <Card>
            <CardHeader>
              <CardTitle>Question</CardTitle>
              <CardDescription>
                {question.type === 'mcq' ? 'Multiple Choice' : 'Open Response'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="font-medium mb-3">{question.text}</p>
              {question.options && question.options.length > 0 && (
                <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                  {question.options.map((opt, i) => (
                    <li key={i}>({String.fromCharCode(65 + i)}) {opt}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* Configuration */}
        {demographicKey && (
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Key</dt>
                  <dd className="font-mono">{demographicKey.key}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Distribution Mode</dt>
                  <dd>{distributionMode === 'n_sample' ? 'N-Sample' : 'Logprobs'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Trials per Backstory</dt>
                  <dd>{numTrials}</dd>
                </div>
                {demographicKey.enum_values && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground mb-1">Values</dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {demographicKey.enum_values.map((val) => (
                        <Badge key={val} variant="secondary">{val}</Badge>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  )
}
