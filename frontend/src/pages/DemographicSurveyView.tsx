import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { supabase } from '@/lib/supabase'
import { useSurveyRun } from '@/hooks/useSurveyRun'
import { SurveyRunProgress, SurveyRunHistory } from '@/components/surveys/SurveyRunProgress'
import { cancelSurveyRun, rerunDemographicSurvey } from '@/lib/surveyRunner'
import { toast } from '@/hooks/use-toast'
import type { Survey, SurveyRun, DemographicKey, DemographicKeyStatus, DistributionMode } from '@/types/database'
import { ArrowLeft, History, RotateCcw, Pencil, Check, X, Plus } from 'lucide-react'

const statusVariants: Record<DemographicKeyStatus, 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' | 'gold'> = {
  pending: 'outline',
  running: 'info',
  finished: 'gold',
  failed: 'destructive',
}

export function DemographicSurveyView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [demographicKey, setDemographicKey] = useState<DemographicKey | null>(null)
  const [loading, setLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [selectedRun, setSelectedRun] = useState<SurveyRun | null>(null)
  const [rerunning, setRerunning] = useState(false)

  // Question editing
  const [editingQuestion, setEditingQuestion] = useState(false)
  const [questionText, setQuestionText] = useState('')
  const [questionOptions, setQuestionOptions] = useState<string[]>([])
  const [newOption, setNewOption] = useState('')
  const [savingQuestion, setSavingQuestion] = useState(false)

  // Config for next re-run
  const [nextDistributionMode, setNextDistributionMode] = useState<DistributionMode>('n_sample')
  const [nextNumTrials, setNextNumTrials] = useState(20)

  const { run: latestRun, runs, isRunning, refresh: refreshRuns } = useSurveyRun({
    surveyId: id,
    autoPoll: true,
    pollInterval: 3000,
  })

  useEffect(() => { fetchData() }, [id])

  useEffect(() => {
    if (latestRun && !isRunning && demographicKey?.status === 'running') {
      fetchDemographicKey(survey?.demographic_key)
    }
  }, [latestRun?.status])

  useEffect(() => {
    if (latestRun?.llm_config) {
      setNextDistributionMode(latestRun.llm_config.distribution_mode || 'n_sample')
      setNextNumTrials(latestRun.llm_config.num_trials || 20)
    }
  }, [latestRun?.id])

  const fetchData = async () => {
    if (!id) return
    const { data: surveyData, error: surveyError } = await supabase
      .from('surveys').select('*').eq('id', id).single()
    if (surveyError) {
      navigate('/demographic-surveys')
      return
    }
    const s = surveyData as Survey
    setSurvey(s)
    setQuestionText(s.questions[0]?.text || '')
    setQuestionOptions(s.questions[0]?.options || [])
    if (s.demographic_key) await fetchDemographicKey(s.demographic_key)
    setLoading(false)
  }

  const fetchDemographicKey = async (keySlug?: string | null) => {
    if (!keySlug) return
    const { data } = await supabase.from('demographic_keys').select('*').eq('key', keySlug).single()
    if (data) setDemographicKey(data as DemographicKey)
  }

  const startEditing = () => {
    const q = survey?.questions[0]
    setQuestionText(q?.text || '')
    setQuestionOptions(q?.options || [])
    setEditingQuestion(true)
  }

  const cancelEditing = () => {
    setEditingQuestion(false)
    setNewOption('')
  }

  const addOption = () => {
    const trimmed = newOption.trim()
    if (!trimmed || questionOptions.includes(trimmed)) return
    setQuestionOptions([...questionOptions, trimmed])
    setNewOption('')
  }

  const removeOption = (val: string) => {
    setQuestionOptions(questionOptions.filter((o) => o !== val))
  }

  const saveQuestion = async () => {
    if (!survey || !demographicKey) return
    if (questionOptions.length < 2) {
      toast({ title: 'At least 2 options required', variant: 'destructive' })
      return
    }
    setSavingQuestion(true)
    try {
      const updatedQuestion = { ...survey.questions[0], text: questionText, options: questionOptions }

      const [surveyRes, dkRes] = await Promise.all([
        supabase.from('surveys').update({ questions: [updatedQuestion] }).eq('id', survey.id),
        supabase.from('demographic_keys').update({ enum_values: questionOptions }).eq('key', demographicKey.key),
      ])
      if (surveyRes.error) throw surveyRes.error
      if (dkRes.error) throw dkRes.error

      setSurvey({ ...survey, questions: [updatedQuestion] })
      setDemographicKey({ ...demographicKey, enum_values: questionOptions })
      setEditingQuestion(false)
      toast({ title: 'Question saved' })
    } catch (e) {
      toast({ title: 'Save failed', description: String(e instanceof Error ? e.message : e), variant: 'destructive' })
    } finally {
      setSavingQuestion(false)
    }
  }

  const handleRerun = async () => {
    if (!survey) return
    setRerunning(true)
    try {
      const llmConfigOverride = {
        ...latestRun?.llm_config,
        distribution_mode: nextDistributionMode,
        num_trials: nextNumTrials,
      }
      const result = await rerunDemographicSurvey(survey.id, llmConfigOverride)
      if (!result.success) {
        toast({ title: 'Re-run failed', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: 'Re-run started', description: 'All previous results cleared. Running from scratch.' })
        setSelectedRun(null)
        refreshRuns()
        fetchDemographicKey(survey.demographic_key)
      }
    } finally {
      setRerunning(false)
    }
  }

  const canRerun = !isRunning && !!latestRun && (latestRun.status === 'cancelled' || latestRun.status === 'failed')
  const displayRun = selectedRun || latestRun

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
              {nextDistributionMode === 'n_sample'
                ? `${nextNumTrials} trials per backstory`
                : 'logprobs mode'}
              {runs.length > 0 && ` · ${runs.length} run${runs.length > 1 ? 's' : ''}`}
            </p>
          </div>
          {canRerun && (
            <Button variant="outline" onClick={handleRerun} disabled={rerunning}>
              <RotateCcw className="h-4 w-4 mr-2" />
              {rerunning ? 'Starting...' : 'Re-run'}
            </Button>
          )}
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
            onTaskRetried={refreshRuns}
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

        {/* Question */}
        {question && (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Question</CardTitle>
                <CardDescription>
                  {question.type === 'mcq' ? 'Multiple Choice' : 'Open Response'}
                </CardDescription>
              </div>
              {!editingQuestion ? (
                <Button variant="ghost" size="icon" onClick={startEditing}>
                  <Pencil className="h-4 w-4" />
                </Button>
              ) : (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={saveQuestion} disabled={savingQuestion}>
                    <Check className="h-4 w-4 text-green-600" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={cancelEditing}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Question text */}
              {editingQuestion ? (
                <Textarea
                  value={questionText}
                  onChange={(e) => setQuestionText(e.target.value)}
                  rows={2}
                />
              ) : (
                <p className="font-medium">{question.text}</p>
              )}

              {/* Options */}
              {editingQuestion ? (
                <div className="space-y-2">
                  <Label>Options</Label>
                  <div className="flex flex-wrap gap-2">
                    {questionOptions.map((opt, i) => (
                      <Badge key={opt} variant="secondary" className="gap-1 pr-1">
                        <span className="text-muted-foreground mr-0.5">({String.fromCharCode(65 + i)})</span>
                        {opt}
                        <button
                          type="button"
                          onClick={() => removeOption(opt)}
                          className="ml-0.5 rounded-full hover:bg-destructive/20 hover:text-destructive p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add option..."
                      value={newOption}
                      onChange={(e) => setNewOption(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption() } }}
                    />
                    <Button variant="outline" size="icon" onClick={addOption} disabled={!newOption.trim()}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                question.options && question.options.length > 0 && (
                  <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                    {question.options.map((opt, i) => (
                      <li key={i}>({String.fromCharCode(65 + i)}) {opt}</li>
                    ))}
                  </ul>
                )
              )}
            </CardContent>
          </Card>
        )}

        {/* Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            {canRerun && (
              <CardDescription>Changes apply on the next Re-run</CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Distribution Mode</Label>
              {canRerun ? (
                <Select
                  value={nextDistributionMode}
                  onValueChange={(v) => setNextDistributionMode(v as DistributionMode)}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="n_sample">N-Sample (any provider)</SelectItem>
                    <SelectItem value="logprobs">Logprobs (vLLM only)</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm">{nextDistributionMode === 'n_sample' ? 'N-Sample' : 'Logprobs (vLLM only)'}</p>
              )}
            </div>

            {nextDistributionMode === 'n_sample' && (
              <div className="space-y-1.5">
                <Label>Trials per Backstory</Label>
                {canRerun ? (
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={nextNumTrials}
                    onChange={(e) => setNextNumTrials(Math.max(1, parseInt(e.target.value, 10) || 20))}
                    className="w-24"
                  />
                ) : (
                  <p className="text-sm">{nextNumTrials}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  )
}
