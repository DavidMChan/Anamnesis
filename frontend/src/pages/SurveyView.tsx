import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { useSurveyRun, useCreateSurveyRun } from '@/hooks/useSurveyRun'
import { SurveyRunProgress, SurveyRunHistory } from '@/components/surveys/SurveyRunProgress'
import { cancelSurveyRun } from '@/lib/surveyRunner'
import { useAuthContext } from '@/contexts/AuthContext'
import type { Survey, SurveyRun, MediaAttachment, LLMConfig, DemographicSelectionConfig, DemographicFilter as DemographicFilterType, SurveyAlgorithm, Question } from '@/types/database'
import { MediaPreview } from '@/components/surveys/MediaPreview'
import { DemographicFilter, defaultDemographicSelectionConfig, legacyToSelectionConfig } from '@/components/surveys/DemographicFilter'
import { getMediaUrl } from '@/lib/media'
import { mergeEffectiveConfig } from '@/lib/llmConfig'
import { RunConfigCard } from '@/components/surveys/RunConfigCard'
import { isDemographicSelectionConfig } from '@/lib/backstoryFilters'
import { buildDemographicPromptText } from '@/lib/demographicPrompt'
import { ArrowLeft, Edit, Play, History, ChevronDown, ChevronRight, Eye } from 'lucide-react'

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

const DEFAULT_ADAPTIVE_SAMPLING = {
  enabled: false,
  epsilon: 0.01,
  min_samples: 30,
}

/** Format a question for the prompt preview, mirroring worker/src/prompt.py formatting. */
function formatQuestionPreview(q: Question): string {
  const letters = (q.options || []).map((_, i) => String.fromCharCode(65 + i))
  const choiceLines = (q.options || []).map((opt, i) => `(${letters[i]}) ${opt}`)

  if (q.type === 'mcq') {
    const answerForcing =
      letters.length > 1
        ? `Answer with ${letters.slice(0, -1).map((l) => `(${l})`).join(', ')}, or (${letters[letters.length - 1]}).`
        : `Answer with (${letters[0]}).`
    return `Question: ${q.text}\n${choiceLines.join('\n')}\n${answerForcing}\nAnswer:`
  }
  if (q.type === 'multiple_select') {
    return `Question: ${q.text}\n${choiceLines.join('\n')}\nSelect all that apply. Answer with comma-separated letters (e.g., A, C, D).\nAnswer:`
  }
  if (q.type === 'ranking') {
    return `Question: ${q.text}\n${choiceLines.join('\n')}\nRank all options from most to least preferred (e.g., A, C, B, D).\nAnswer:`
  }
  // open_response
  return `Question: ${q.text}\nAnswer:`
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
  const [runOverrides, setRunOverrides] = useState<Partial<LLMConfig>>({})
  const [questionsExpanded, setQuestionsExpanded] = useState(false)
  const [runDemographics, setRunDemographics] = useState<DemographicSelectionConfig>(defaultDemographicSelectionConfig())
  const [runAlgorithm, setRunAlgorithm] = useState<SurveyAlgorithm>('anthology')
  const [runPromptText, setRunPromptText] = useState('')
  const [adaptiveSampling, setAdaptiveSampling] = useState(DEFAULT_ADAPTIVE_SAMPLING)

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

  // Initialize run demographics from survey defaults when survey loads
  useEffect(() => {
    if (!survey) return
    // Convert legacy format if needed
    const stored = survey.demographics
    if (stored && 'mode' in stored && 'filters' in stored) {
      setRunDemographics(stored as unknown as DemographicSelectionConfig)
    } else {
      setRunDemographics(legacyToSelectionConfig(stored as DemographicFilterType & { _sample_size?: number[] }))
    }
  }, [survey?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-generate the zero-shot prompt whenever algorithm or demographics change.
  // User can freely edit the generated text afterwards.
  useEffect(() => {
    if (runAlgorithm !== 'zero_shot_baseline') return
    const filters = isDemographicSelectionConfig(runDemographics)
      ? runDemographics.filters
      : runDemographics
    setRunPromptText(buildDemographicPromptText(filters))
  }, [runAlgorithm, runDemographics]) // eslint-disable-line react-hooks/exhaustive-deps

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

    // Merge profile defaults + local overrides into run config snapshot
    const runLlmConfig = {
      ...mergeEffectiveConfig(llmConfig, runOverrides),
      ...(adaptiveSampling.enabled ? { adaptive_sampling: adaptiveSampling } : {}),
    }
    const promptText = runAlgorithm === 'zero_shot_baseline' ? runPromptText : undefined
    const runId = await createRun(survey.id, runLlmConfig, runDemographics, runAlgorithm, promptText)
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
            creatingRun={creatingRun}
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
          <CardHeader
            className="cursor-pointer"
            onClick={() => setQuestionsExpanded(!questionsExpanded)}
          >
            <div className="flex items-center justify-between">
              <CardTitle>Questions</CardTitle>
              <div className="flex items-center gap-2">
                {survey.status === 'draft' && (
                  <Link
                    to={`/surveys/${survey.id}/edit`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button variant="outline" size="sm">
                      <Edit className="h-3.5 w-3.5 mr-1.5" />
                      Edit
                    </Button>
                  </Link>
                )}
                {questionsExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
            <CardDescription>
              {survey.questions.length} questions in this survey
            </CardDescription>
          </CardHeader>
          {questionsExpanded && <CardContent>
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
          </CardContent>}
        </Card>

        {/* Adaptive Sampling */}
        <Card>
          <CardHeader>
            <CardTitle>Sample Stopping</CardTitle>
            <CardDescription>
              Optionally stop the run once closed-choice answers are statistically stable.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={adaptiveSampling.enabled}
                onCheckedChange={(checked) =>
                  setAdaptiveSampling((current) => ({ ...current, enabled: checked === true }))
                }
                className="mt-0.5"
              />
              <div className="space-y-1">
                <span className="text-sm font-medium">Run until stable</span>
                <p className="text-sm text-muted-foreground">
                  Uses the sample size below as a maximum and finishes early when MCQ answer rankings are stable.
                </p>
              </div>
            </label>

            {adaptiveSampling.enabled && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="adaptive-epsilon">Epsilon</Label>
                  <Input
                    id="adaptive-epsilon"
                    type="number"
                    min={0.0001}
                    max={0.5}
                    step={0.001}
                    value={adaptiveSampling.epsilon}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      if (Number.isFinite(value)) {
                        setAdaptiveSampling((current) => ({ ...current, epsilon: value }))
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    0.01 stops when the lower-bound probability of the current adjacent ordering is at least 99%.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adaptive-min-samples">Minimum samples</Label>
                  <Input
                    id="adaptive-min-samples"
                    type="number"
                    min={2}
                    step={1}
                    value={adaptiveSampling.min_samples}
                    onChange={(event) => {
                      const value = parseInt(event.target.value, 10)
                      if (Number.isFinite(value)) {
                        setAdaptiveSampling((current) => ({ ...current, min_samples: Math.max(2, value) }))
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Prevents stopping from very small early samples.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Run Configuration — local state, applied when "Run Survey" is clicked */}
        <RunConfigCard
          profileConfig={profile?.llm_config}
          overrides={runOverrides}
          onChangeOverrides={setRunOverrides}
        />

        {/* Algorithm Selector */}
        <Card>
          <CardHeader>
            <CardTitle>Algorithm</CardTitle>
            <CardDescription>
              How the LLM will be prompted for each response
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="run-algorithm"
                  value="anthology"
                  checked={runAlgorithm === 'anthology'}
                  onChange={() => setRunAlgorithm('anthology')}
                  className="accent-primary"
                />
                <span className="font-medium">Anthology</span>
                <span className="text-muted-foreground text-sm">(run once per backstory)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="run-algorithm"
                  value="zero_shot_baseline"
                  checked={runAlgorithm === 'zero_shot_baseline'}
                  onChange={() => setRunAlgorithm('zero_shot_baseline')}
                  className="accent-primary"
                />
                <span className="font-medium">Zero-Shot Baseline</span>
                <span className="text-muted-foreground text-sm">(demographic description, N independent trials)</span>
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Demographic Filters (editable per-run) */}
        <DemographicFilter
          value={runDemographics}
          onChange={setRunDemographics}
          description="Settings for the next run (empty = inherit from initial survey settings)"
          sampleSizeLabel={
            adaptiveSampling.enabled
              ? 'Maximum samples'
              : runAlgorithm === 'zero_shot_baseline'
                ? 'Number of trials'
                : undefined
          }
        />

        {/* Prompt Preview */}
        {survey.questions.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                <CardTitle>Prompt Preview</CardTitle>
              </div>
              <CardDescription>
                {runAlgorithm === 'zero_shot_baseline'
                  ? `What will be sent to the LLM for each trial (${adaptiveSampling.enabled ? 'up to ' : 'repeated '}${runDemographics.sample_size ?? '?'} times independently)`
                  : 'What will be sent to the LLM for each backstory (run once per backstory)'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {runAlgorithm === 'zero_shot_baseline' ? (
                <>
                  <textarea
                    className="w-full text-sm bg-muted rounded-lg p-4 font-mono leading-relaxed border-0 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                    rows={3}
                    value={runPromptText}
                    onChange={(e) => setRunPromptText(e.target.value)}
                  />
                  <pre className="text-sm bg-muted rounded-lg p-4 whitespace-pre-wrap font-mono overflow-x-auto leading-relaxed text-muted-foreground">
                    {'\n'}
                    {formatQuestionPreview(survey.questions[0])}
                    {survey.questions.length > 1 && (
                      <>{'\n\n'}{`// + ${survey.questions.length - 1} more question(s)`}</>
                    )}
                  </pre>
                </>
              ) : (
                <pre className="text-sm bg-muted rounded-lg p-4 whitespace-pre-wrap font-mono overflow-x-auto leading-relaxed">
                  <span className="text-muted-foreground italic">[backstory text]</span>
                  {'\n\n'}
                  {formatQuestionPreview(survey.questions[0])}
                  {survey.questions.length > 1 && (
                    <span className="text-muted-foreground">
                      {'\n\n'}
                      {`// + ${survey.questions.length - 1} more question(s) with context accumulation`}
                    </span>
                  )}
                </pre>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  )
}
