import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { useSurveyRun, useCreateSurveyRun } from '@/hooks/useSurveyRun'
import { SurveyRunProgress, SurveyRunHistory } from '@/components/surveys/SurveyRunProgress'
import { cancelSurveyRun } from '@/lib/surveyRunner'
import { useAuthContext } from '@/contexts/AuthContext'
import type { Survey, SurveyRun, MediaAttachment } from '@/types/database'
import { MediaPreview } from '@/components/surveys/MediaPreview'
import { getMediaUrl } from '@/lib/media'
import { ArrowLeft, Edit, Play, History, Settings } from 'lucide-react'

/** Standalone audio player that loads its own URL from a media key */
function AudioPlayer({ media }: { media: MediaAttachment }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getMediaUrl(media.key)
      .then((u) => { if (!cancelled) setUrl(u) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [media.key])

  if (!url) {
    return <span className="text-xs text-muted-foreground italic">Loading audio...</span>
  }

  return <audio controls src={url} className="w-full" />
}

/**
 * Check if a model supports multimodal input via the OpenRouter models API.
 */
async function checkMultimodalSupport(modelId: string): Promise<boolean> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models')
    if (!response.ok) return true
    const data = await response.json()
    const models = data?.data as Array<{ id: string; architecture?: { modality?: string } }> | undefined
    if (!models) return true
    const model = models.find((m) => m.id === modelId)
    if (!model) return true
    const modality = model.architecture?.modality || ''
    return modality.includes('image') || modality.includes('multimodal') || modality.includes('audio')
  } catch {
    return true
  }
}

const statusColors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline' | 'gold'> = {
  draft: 'secondary',
  active: 'gold',
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
  const { user, profile, maskedApiKeys } = useAuthContext()
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [loading, setLoading] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [selectedRun, setSelectedRun] = useState<SurveyRun | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [expandedAudio, setExpandedAudio] = useState<{ qkey: string; optIndex: number } | null>(null)

  // Fetch survey run data
  const { run: latestRun, runs, isRunning, refresh: refreshRuns } = useSurveyRun({
    surveyId: id,
    autoPoll: true,
    pollInterval: 3000,
  })

  const { createRun, loading: creatingRun, error: createError } = useCreateSurveyRun()

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
    } else {
      setSurvey(data as Survey)
    }
    setLoading(false)
  }

  const runSurvey = async () => {
    if (!survey || !user) return
    setConfigError(null)

    // Validate LLM config before creating tasks
    const llmConfig = profile?.llm_config
    if (!llmConfig?.provider) {
      setConfigError('No LLM provider configured. Please set up your LLM settings in the Settings page before running a survey.')
      return
    }
    if (llmConfig.provider === 'openrouter') {
      if (!maskedApiKeys.openrouter) {
        setConfigError('OpenRouter API key is missing. Please add your API key in the Settings page.')
        return
      }
      if (!llmConfig.openrouter_model) {
        setConfigError('OpenRouter model is not set. Please configure it in the Settings page.')
        return
      }
    } else if (llmConfig.provider === 'vllm') {
      if (!llmConfig.vllm_endpoint) {
        setConfigError('vLLM endpoint is not set. Please configure it in the Settings page.')
        return
      }
      if (!llmConfig.vllm_model) {
        setConfigError('vLLM model is not set. Please configure it in the Settings page.')
        return
      }
    }

    // Check if survey has media attachments
    const hasMedia = survey.questions.some(
      (q) => q.media || q.option_media?.some((m) => m != null)
    )

    if (hasMedia) {
      const modelId = llmConfig.provider === 'openrouter' ? llmConfig.openrouter_model : llmConfig.vllm_model
      const isMultimodal = await checkMultimodalSupport(modelId || '')
      if (!isMultimodal) {
        setConfigError(
          `Your model (${modelId}) may not support multimodal input. This survey has questions with media attachments. ` +
          'Please use a multimodal model (e.g., google/gemini-2.0-flash, anthropic/claude-sonnet-4, openai/gpt-4o).'
        )
        return
      }
    }

    // Merge per-survey settings into llm_config snapshot
    const runLlmConfig = {
      ...llmConfig,
      ...(survey.temperature != null && { temperature: survey.temperature }),
      ...(survey.max_tokens != null && { max_tokens: survey.max_tokens }),
    }
    const runId = await createRun(survey.id, runLlmConfig)
    if (runId) {
      refreshRuns()
      fetchSurvey()
    }
  }

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

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/surveys')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">{survey.name || 'Untitled Survey'}</h1>
              <Badge variant={statusColors[survey.status]}>
                {survey.status === 'active' ? 'Active' : 'Draft'}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              {survey.questions.length} questions • Created {new Date(survey.created_at).toLocaleDateString()}
              {runs.length > 0 && ` • ${runs.length} run${runs.length > 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex gap-2">
            {survey.status === 'draft' && (
              <Link to={`/surveys/${survey.id}/edit`}>
                <Button variant="outline">
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              </Link>
            )}
            {runs.length > 0 && (
              <Button variant="outline" onClick={() => setShowHistory(!showHistory)}>
                <History className="h-4 w-4 mr-2" />
                History
              </Button>
            )}
            <Button onClick={runSurvey} disabled={creatingRun || isRunning}>
              <Play className="h-4 w-4 mr-2" />
              {creatingRun ? 'Starting...' : isRunning ? 'Running...' : 'Run Survey'}
            </Button>
          </div>
        </div>

        {/* Error messages */}
        {(configError || createError) && (
          <div className="p-4 rounded-lg border border-destructive bg-destructive/10 text-destructive">
            {configError || createError}
            {configError?.includes('Settings page') && (
              <Link to="/settings" className="ml-1 underline font-medium hover:opacity-80">
                Go to Settings
              </Link>
            )}
          </div>
        )}

        {/* Run Progress */}
        {displayRun && (
          <SurveyRunProgress
            run={displayRun}
            onViewResults={() => navigate(`/surveys/${survey.id}/results?run=${displayRun.id}`)}
            onRunAgain={runSurvey}
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

        {/* Questions */}
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
                  {question.media && (
                    <div className="mb-2">
                      <MediaPreview media={question.media} />
                    </div>
                  )}
                  {question.options && question.options.length > 0 && (
                    <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                      {question.options.map((option, optIndex) => {
                        const optMedia = question.option_media?.[optIndex]
                        const isAudioOpt = optMedia && !optMedia.type.startsWith('image/')
                        const isThisExpanded = expandedAudio?.qkey === question.qkey && expandedAudio?.optIndex === optIndex

                        return (
                          <li key={optIndex} className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span>
                                {question.type === 'ranking' ? `${optIndex + 1}. ` : '• '}
                                {option}
                              </span>
                              {optMedia && (
                                <MediaPreview
                                  media={optMedia}
                                  compact
                                  isAudioExpanded={isThisExpanded}
                                  onAudioToggle={isAudioOpt ? (expanded) => setExpandedAudio(expanded ? { qkey: question.qkey, optIndex } : null) : undefined}
                                />
                              )}
                            </div>
                            {isThisExpanded && isAudioOpt && optMedia && (
                              <div className="ml-4">
                                <AudioPlayer media={optMedia} />
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Per-Survey LLM Settings */}
        {(survey.temperature != null || survey.max_tokens != null) && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                <CardTitle>LLM Settings</CardTitle>
              </div>
              <CardDescription>
                Per-survey overrides for this survey
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-6 text-sm">
                {survey.temperature != null && (
                  <div>
                    <span className="font-medium">Temperature:</span>{' '}
                    <span className="text-muted-foreground">{survey.temperature}</span>
                  </div>
                )}
                {survey.max_tokens != null && (
                  <div>
                    <span className="font-medium">Max Tokens:</span>{' '}
                    <span className="text-muted-foreground">{survey.max_tokens}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Demographic Filters */}
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
