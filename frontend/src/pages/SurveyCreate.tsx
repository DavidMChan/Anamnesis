import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { QuestionEditor } from '@/components/surveys/QuestionEditor'
import { DemographicFilter } from '@/components/surveys/DemographicFilter'
import { supabase } from '@/lib/supabase'
import { useAuthContext } from '@/contexts/AuthContext'
import { useCreateSurveyRun } from '@/hooks/useSurveyRun'
import type { Question, DemographicFilter as DemographicFilterType, Survey, LLMConfig } from '@/types/database'
import { toast } from '@/hooks/use-toast'
import { deleteMedia, copyMedia } from '@/lib/media'
import { mergeEffectiveConfig, LLM_DEFAULTS } from '@/lib/llmConfig'
import type { MediaAttachment } from '@/types/database'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Save, Play, ArrowLeft, Settings } from 'lucide-react'

/**
 * Check if a model supports multimodal input via the OpenRouter models API.
 * Returns true if the model supports vision/multimodal, or if we can't determine (allow proceeding).
 */
async function checkMultimodalSupport(modelId: string): Promise<boolean> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models')
    if (!response.ok) return true // Can't check — allow proceeding

    const data = await response.json()
    const models = data?.data as Array<{ id: string; architecture?: { modality?: string } }> | undefined
    if (!models) return true

    const model = models.find((m) => m.id === modelId)
    if (!model) return true // Unknown model — allow proceeding

    // Check modality field (e.g., "text->text", "text+image->text")
    const modality = model.architecture?.modality || ''
    return modality.includes('image') || modality.includes('multimodal') || modality.includes('audio')
  } catch {
    return true // Network error — allow proceeding
  }
}

/** Collect all Wasabi media keys referenced by a list of questions. */
function collectMediaKeys(qs: Question[]): Set<string> {
  const keys = new Set<string>()
  for (const q of qs) {
    if (q.media?.key) keys.add(q.media.key)
    q.option_media?.forEach((m) => { if (m?.key) keys.add(m.key) })
  }
  return keys
}

export function SurveyCreate() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, profile, maskedApiKeys } = useAuthContext()
  const isEditing = !!id

  const [name, setName] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [demographics, setDemographics] = useState<DemographicFilterType>({})
  const [sampleSize, setSampleSize] = useState<number | undefined>(undefined)
  const [llmConfig, setLlmConfig] = useState<Partial<LLMConfig>>({})
  const [includeOwnBackstories, setIncludeOwnBackstories] = useState(false)
  const [surveyStatus, setSurveyStatus] = useState<'draft' | 'active'>('draft')
  const [ownBackstoriesCount, setOwnBackstoriesCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Baseline snapshot of questions as last persisted in DB — used to diff orphaned media on save
  const savedQuestionsRef = useRef<Question[]>([])

  const { createRun, loading: creatingRun } = useCreateSurveyRun()

  const isActiveEditing = isEditing && surveyStatus === 'active'

  useEffect(() => {
    if (isEditing) {
      loadSurvey()
    }
    fetchOwnBackstoriesCount()
  }, [id, user])

  const loadSurvey = async () => {
    if (!id) return
    const { data, error } = await supabase
      .from('surveys')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      console.error('Error loading survey:', error)
      navigate('/surveys')
    } else if (data) {
      const survey = data as Survey
      setName(survey.name || '')
      setQuestions(survey.questions)
      savedQuestionsRef.current = survey.questions
      setSurveyStatus(survey.status)
      // Extract sample size from demographics if present
      const { _sample_size, ...restDemographics } = survey.demographics as DemographicFilterType & { _sample_size?: number[] }
      setDemographics(restDemographics)
      setSampleSize(_sample_size?.[0])
      setLlmConfig(survey.llm_config || {})
    }
  }

  const fetchOwnBackstoriesCount = async () => {
    if (!user) return

    const { count } = await supabase
      .from('backstories')
      .select('id', { count: 'exact', head: true })
      .eq('contributor_id', user.id)

    setOwnBackstoriesCount(count || 0)
  }

  const addQuestion = () => {
    const newQuestion: Question = {
      qkey: `q${questions.length + 1}`,
      type: 'mcq',
      text: '',
      options: ['', ''],
    }
    setQuestions([...questions, newQuestion])
  }

  const updateQuestion = (index: number, question: Question) => {
    const newQuestions = [...questions]
    newQuestions[index] = question
    setQuestions(newQuestions)
  }

  const deleteQuestion = (index: number) => {
    setQuestions(questions.filter((_, i) => i !== index))
  }

  const duplicateQuestion = async (index: number) => {
    const src = questions[index]
    const hasMedia = !!(src.media || src.option_media?.some((m) => m != null))

    let copiedMedia: MediaAttachment | undefined
    let copiedOptionMedia: (MediaAttachment | null)[] | undefined
    let copyFailed = false

    if (hasMedia) {
      setDuplicating(true)
      try {
        copiedMedia = src.media ? await copyMedia(src.media) : undefined
        copiedOptionMedia = src.option_media
          ? await Promise.all(src.option_media.map((m) => (m ? copyMedia(m) : null)))
          : undefined
      } catch {
        copyFailed = true
      }
      setDuplicating(false)
    }

    const newQuestion: Question = {
      ...src,
      qkey: `q${Date.now()}`,
      options: src.options ? [...src.options] : undefined,
      media: copiedMedia,
      option_media: copiedOptionMedia?.length ? copiedOptionMedia : undefined,
    }
    const newQuestions = [...questions]
    newQuestions.splice(index + 1, 0, newQuestion)
    setQuestions(newQuestions)
    toast({ title: copyFailed ? 'Copied (without media — copy failed)' : 'Copied!' })
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setQuestions((items) => {
        const oldIndex = items.findIndex((item) => item.qkey === active.id)
        const newIndex = items.findIndex((item) => item.qkey === over.id)
        return arrayMove(items, oldIndex, newIndex)
      })
    }
  }

  const validateSurvey = (): string | null => {
    if (!name.trim()) {
      return 'Please enter a survey name'
    }
    if (questions.length === 0) {
      return 'Please add at least one question'
    }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      if (!q.text.trim() && !q.media) {
        return `Question ${i + 1} needs text or media`
      }
      if (q.type !== 'open_response' && (!q.options || q.options.length < 2)) {
        return `Question ${i + 1} needs at least 2 options`
      }
      if (q.options?.some((opt, j) => !opt.trim() && !q.option_media?.[j])) {
        return `Question ${i + 1} has empty options (add text or media)`
      }
    }
    return null
  }

  const saveSurvey = async (status: 'draft' | 'active' = 'draft') => {
    if (!user) return

    const validationError = validateSurvey()
    if (validationError) {
      setError(validationError)
      return null
    }

    setError(null)
    setSaving(true)

    // Combine demographics with sample size (if set)
    const demographicsWithSampleSize = sampleSize
      ? { ...demographics, _sample_size: [sampleSize] }
      : demographics

    // Clean llm_config: strip empty values
    const cleanedLlmConfig: Partial<LLMConfig> = {}
    for (const [k, v] of Object.entries(llmConfig)) {
      if (v !== '' && v != null) {
        (cleanedLlmConfig as Record<string, unknown>)[k] = v
      }
    }

    const surveyData = {
      user_id: user.id,
      name: name.trim(),
      questions: questions as unknown,
      demographics: demographicsWithSampleSize as unknown,
      status,
      llm_config: Object.keys(cleanedLlmConfig).length > 0 ? cleanedLlmConfig : null,
    } as Record<string, unknown>

    let result: Survey | null = null

    if (isEditing && id) {
      const { data, error } = await supabase
        .from('surveys')
        .update(surveyData)
        .eq('id', id)
        .select()
        .single()

      if (error) {
        console.error('Error updating survey:', error)
        setError('Failed to save survey')
      } else {
        result = data as Survey
      }
    } else {
      const { data, error } = await supabase
        .from('surveys')
        .insert(surveyData)
        .select()
        .single()

      if (error) {
        console.error('Error creating survey:', error)
        setError('Failed to create survey')
      } else {
        result = data as Survey
      }
    }

    // After successful DB save, clean up orphaned Wasabi media
    if (result) {
      const prevKeys = collectMediaKeys(savedQuestionsRef.current)
      const currKeys = collectMediaKeys(questions)
      for (const key of prevKeys) {
        if (!currKeys.has(key)) deleteMedia(key)
      }
      savedQuestionsRef.current = questions
    }

    setSaving(false)
    return result
  }

  const handleSaveDraft = async () => {
    const result = await saveSurvey('draft')
    if (result) {
      navigate(`/surveys/${result.id}`)
    }
  }

  const handleRunSurvey = async () => {
    if (!user) return

    // Validate LLM config before creating tasks
    const llmConfig = profile?.llm_config
    if (!llmConfig?.provider) {
      setError('No LLM provider configured. Please set up your LLM settings in the Settings page before running a survey.')
      return
    }
    if (llmConfig.provider === 'openrouter') {
      if (!maskedApiKeys.openrouter) {
        setError('OpenRouter API key is missing. Please add your API key in the Settings page.')
        return
      }
      if (!llmConfig.openrouter_model) {
        setError('OpenRouter model is not set. Please configure it in the Settings page.')
        return
      }
    } else if (llmConfig.provider === 'vllm') {
      if (!llmConfig.vllm_endpoint) {
        setError('vLLM endpoint is not set. Please configure it in the Settings page.')
        return
      }
      if (!llmConfig.vllm_model) {
        setError('vLLM model is not set. Please configure it in the Settings page.')
        return
      }
    }

    // Check if survey has media attachments
    const hasMedia = questions.some(
      (q) => q.media || q.option_media?.some((m) => m != null)
    )

    if (hasMedia) {
      // Validate multimodal model support
      const modelId = llmConfig.provider === 'openrouter' ? llmConfig.openrouter_model : llmConfig.vllm_model
      const isMultimodal = await checkMultimodalSupport(modelId || '')

      if (!isMultimodal) {
        setError(
          `Your model (${modelId}) may not support multimodal input. This survey has questions with media attachments. ` +
          'Please use a multimodal model (e.g., google/gemini-2.0-flash, anthropic/claude-sonnet-4, openai/gpt-4o) ' +
          'or remove media from your questions.'
        )
        return
      }
    }

    // Save as draft first, createSurveyRun will set it to 'active'
    const result = await saveSurvey('draft')
    if (result) {
      // Merge per-survey settings into llm_config snapshot
      const runLlmConfig = mergeEffectiveConfig(profile?.llm_config, result.llm_config)
      const runId = await createRun(result.id, runLlmConfig)
      if (runId) {
        navigate(`/surveys/${result.id}`)
      } else {
        setError('Failed to start survey run')
      }
    }
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/surveys')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">
              {isEditing ? 'Edit Survey' : 'Create Survey'}
            </h1>
            <p className="text-muted-foreground">
              {isEditing ? 'Update your survey questions and settings' : 'Design your survey questions'}
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 text-sm text-red-500 bg-red-50 border border-red-200 rounded-md">
            {error}
            {error.includes('Settings page') && (
              <Link to="/settings" className="ml-1 underline font-medium hover:text-red-700">
                Go to Settings
              </Link>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Survey Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="name">Survey Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Political Attitudes Survey"
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Questions</h2>
            {isActiveEditing ? (
              <Badge variant="secondary">Locked (survey has been run)</Badge>
            ) : (
              <Button onClick={addQuestion}>
                <Plus className="h-4 w-4 mr-2" />
                Add Question
              </Button>
            )}
          </div>

          {questions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <p className="text-muted-foreground mb-4">No questions yet. Add your first question!</p>
                <Button onClick={addQuestion}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Question
                </Button>
              </CardContent>
            </Card>
          ) : isActiveEditing ? (
            /* Read-only question display for active surveys */
            <div className="space-y-4">
              {questions.map((question, index) => (
                <Card key={question.qkey} className="opacity-75">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-sm font-medium text-muted-foreground">Q{index + 1}</span>
                      <Badge variant="outline">{question.type}</Badge>
                    </div>
                    <p className="font-medium mb-2">{question.text}</p>
                    {question.options && (
                      <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                        {question.options.map((opt, i) => (
                          <li key={i}>{question.type === 'ranking' ? `${i + 1}. ` : '• '}{opt}</li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={questions.map((q) => q.qkey)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-4">
                  {questions.map((question, index) => (
                    <QuestionEditor
                      key={question.qkey}
                      question={question}
                      index={index}
                      onChange={(q) => updateQuestion(index, q)}
                      onDelete={() => deleteQuestion(index)}
                      onDuplicate={() => !duplicating && duplicateQuestion(index)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <DemographicFilter
          value={demographics}
          onChange={setDemographics}
          sampleSize={sampleSize}
          onSampleSizeChange={setSampleSize}
        />

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              <CardTitle className="text-base">LLM Settings</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              Override provider, model, temperature and max tokens for this survey (empty = inherit from profile)
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Provider Override</Label>
              <Select
                value={llmConfig.provider || ''}
                onValueChange={(v) => setLlmConfig({ ...llmConfig, provider: (v || undefined) as LLMConfig['provider'] })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Inherit from profile" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                  <SelectItem value="vllm">vLLM</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(llmConfig.provider === 'openrouter' || (!llmConfig.provider && profile?.llm_config?.provider === 'openrouter')) && (
              <div className="space-y-2">
                <Label>Model Override</Label>
                <Input
                  value={llmConfig.openrouter_model ?? ''}
                  onChange={(e) => setLlmConfig({ ...llmConfig, openrouter_model: e.target.value || undefined })}
                  placeholder={profile?.llm_config?.openrouter_model || 'anthropic/claude-3-haiku'}
                />
              </div>
            )}
            {(llmConfig.provider === 'vllm' || (!llmConfig.provider && profile?.llm_config?.provider === 'vllm')) && (
              <div className="space-y-2">
                <Label>Model Override</Label>
                <Input
                  value={llmConfig.vllm_model ?? ''}
                  onChange={(e) => setLlmConfig({ ...llmConfig, vllm_model: e.target.value || undefined })}
                  placeholder={profile?.llm_config?.vllm_model || 'meta-llama/Llama-3-70b'}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="survey_temperature">Temperature</Label>
                <Input
                  id="survey_temperature"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={llmConfig.temperature ?? ''}
                  onChange={(e) =>
                    setLlmConfig({ ...llmConfig, temperature: e.target.value ? parseFloat(e.target.value) : undefined })
                  }
                  placeholder={`${LLM_DEFAULTS.temperature} (default)`}
                />
                <p className="text-xs text-muted-foreground">
                  Controls randomness. 0 = deterministic.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="survey_max_tokens">Max Tokens</Label>
                <Input
                  id="survey_max_tokens"
                  type="number"
                  min="1"
                  max="16384"
                  step="1"
                  value={llmConfig.max_tokens ?? ''}
                  onChange={(e) =>
                    setLlmConfig({ ...llmConfig, max_tokens: e.target.value ? parseInt(e.target.value, 10) : undefined })
                  }
                  placeholder={`${LLM_DEFAULTS.max_tokens} (default)`}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum tokens in response.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {ownBackstoriesCount > 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-own"
                  checked={includeOwnBackstories}
                  onCheckedChange={(checked) => setIncludeOwnBackstories(checked as boolean)}
                />
                <label htmlFor="include-own" className="text-sm">
                  Also include my own backstories ({ownBackstoriesCount} available)
                </label>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-end gap-4 pb-8">
          <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Draft'}
          </Button>
          <Button onClick={handleRunSurvey} disabled={creatingRun || saving}>
            <Play className="h-4 w-4 mr-2" />
            {creatingRun ? 'Starting...' : 'Run Survey'}
          </Button>
        </div>
      </div>
    </Layout>
  )
}
