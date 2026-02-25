import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { supabase } from '@/lib/supabase'
import { useAuthContext } from '@/contexts/AuthContext'
import { DemographicKeyForm, type DemographicKeyFormData } from '@/components/demographic-surveys/DemographicKeyForm'
import { RunConfigCard } from '@/components/surveys/RunConfigCard'
import { createDemographicSurveyRun } from '@/lib/surveyRunner'
import { mergeEffectiveConfig } from '@/lib/llmConfig'
import { toast } from '@/hooks/use-toast'
import type { LLMConfig } from '@/types/database'
import { ArrowLeft, Play, Eye } from 'lucide-react'

const defaultFormData: DemographicKeyFormData = {
  key: '',
  displayName: '',
  enumValues: [],
  distributionMode: 'n_sample',
  numTrials: 20,
  question: {
    qkey: 'demographic_q',
    type: 'mcq',
    text: '',
  },
}

const HOW_IT_WORKS_STEPS = [
  { num: 1, title: 'Define', desc: 'Name the demographic and list possible values' },
  { num: 2, title: 'Survey', desc: 'The LLM answers a multiple-choice question for each backstory' },
  { num: 3, title: 'Results', desc: 'Becomes a filterable demographic on all backstories for everyone to use' },
]

export function DemographicSurveyCreate() {
  const navigate = useNavigate()
  const { user, profile, maskedApiKeys } = useAuthContext()
  const [formData, setFormData] = useState<DemographicKeyFormData>(defaultFormData)
  const [existingKeys, setExistingKeys] = useState<string[]>([])
  const [runOverrides, setRunOverrides] = useState<Partial<LLMConfig>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchExistingKeys()
  }, [])

  const fetchExistingKeys = async () => {
    const { data } = await supabase
      .from('demographic_keys')
      .select('key')
    if (data) {
      setExistingKeys(data.map((d) => d.key))
    }
  }

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {}
    if (!formData.displayName) errors.displayName = 'Display name is required'
    if (!formData.key) errors.key = 'Name is required to generate a key'
    if (existingKeys.includes(formData.key)) errors.key = 'A demographic with this name already exists'
    if (formData.enumValues.length < 2) {
      errors.enumValues = 'At least 2 values required'
    }
    if (!formData.question.text) errors.question = 'Question text is required'
    return errors
  }

  const handleSubmit = async () => {
    if (!user) return
    setError(null)

    const validationErrors = validate()
    if (Object.keys(validationErrors).length > 0) {
      setError(Object.values(validationErrors)[0])
      return
    }

    // Validate LLM config
    const llmConfig = profile?.llm_config
    if (!llmConfig?.provider) {
      setError('No LLM provider configured. Please set up your LLM settings in the Settings page.')
      return
    }
    if (llmConfig.provider === 'openrouter' && !maskedApiKeys.openrouter) {
      setError('OpenRouter API key is missing. Please add your API key in the Settings page.')
      return
    }

    // Logprobs mode requires vLLM (check effective provider, which may include run overrides)
    if (formData.distributionMode === 'logprobs') {
      const effectiveConfig = mergeEffectiveConfig(llmConfig, runOverrides)
      if (effectiveConfig.provider !== 'vllm') {
        toast({ title: 'Logprobs mode requires vLLM provider', variant: 'destructive' })
        return
      }
    }

    setSubmitting(true)

    try {
      // 1. Create the demographic_keys row with status = 'running'
      const { error: dkError } = await supabase
        .from('demographic_keys')
        .insert({
          key: formData.key,
          display_name: formData.displayName,
          value_type: 'enum',
          enum_values: formData.enumValues,
          status: 'running',
          created_by: user.id,
        })

      if (dkError) {
        throw new Error(dkError.message)
      }

      // 2. Create the survey record (type = 'demographic', links to the key)
      const { data: survey, error: surveyError } = await supabase
        .from('surveys')
        .insert({
          user_id: user.id,
          name: `Demographic: ${formData.displayName}`,
          questions: [formData.question],
          demographics: {},
          status: 'active',
          type: 'demographic',
          demographic_key: formData.key,
        })
        .select()
        .single()

      if (surveyError || !survey) {
        // Clean up the demographic key
        await supabase.from('demographic_keys').delete().eq('key', formData.key)
        throw new Error(surveyError?.message || 'Failed to create survey')
      }

      // 3. Create a survey run — distribution_mode/num_trials go in llm_config snapshot
      const runLlmConfig = {
        ...mergeEffectiveConfig(llmConfig, runOverrides),
        distribution_mode: formData.distributionMode as 'n_sample' | 'logprobs',
        num_trials: formData.numTrials,
      }
      const result = await createDemographicSurveyRun({
        surveyId: survey.id,
        llmConfig: runLlmConfig,
      })

      if (!result.success) {
        throw new Error(result.error || 'Failed to create survey run')
      }

      toast({ title: 'Demographic survey created and started!' })
      navigate(`/demographic-surveys/${survey.id}`)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/demographic-surveys')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">New Demographic Survey</h1>
            <p className="text-muted-foreground">
              Your target demographics are not on the list? Define your own here.
            </p>
          </div>
        </div>

        {/* How It Works strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {HOW_IT_WORKS_STEPS.map((step) => (
            <div key={step.num} className="flex items-start gap-3 p-3 rounded-lg">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold">
                {step.num}
              </div>
              <div>
                <p className="text-sm font-medium leading-tight">{step.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 rounded-lg border border-destructive bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Form */}
        <DemographicKeyForm
          value={formData}
          onChange={setFormData}
          existingKeys={existingKeys}
        />

        {/* Run Configuration */}
        <RunConfigCard
          profileConfig={profile?.llm_config}
          overrides={runOverrides}
          onChangeOverrides={setRunOverrides}
        />

        {/* Prompt Preview */}
        {formData.question.text && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                <CardTitle>Prompt Preview</CardTitle>
              </div>
              <CardDescription>
                What will be sent to the LLM for each backstory (repeated {formData.numTrials} times independently)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-sm bg-muted rounded-lg p-4 whitespace-pre-wrap font-mono overflow-x-auto leading-relaxed">
                <span className="text-muted-foreground italic">{'[backstory text]'}</span>
                {'\n\n'}
                {formData.question.type === 'mcq' ? (
                  <>
                    {`Question: ${formData.question.text}`}
                    {formData.question.options?.map((opt, i) => (
                      `\n(${String.fromCharCode(65 + i)}) ${opt}`
                    )).join('')}
                    {`\nAnswer with ${formData.question.options?.map((_, i) => `(${String.fromCharCode(65 + i)})`).join(', ')}.`}
                    {'\nAnswer:'}
                  </>
                ) : (
                  <>
                    {`Question: ${formData.question.text}`}
                    {'\nAnswer:'}
                  </>
                )}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* Submit */}
        <div className="flex justify-end">
          <Button
            size="lg"
            onClick={handleSubmit}
            disabled={submitting || !formData.key || !formData.displayName || !formData.question.text}
          >
            <Play className="h-4 w-4 mr-2" />
            {submitting ? 'Creating...' : 'Create & Run'}
          </Button>
        </div>
      </div>
    </Layout>
  )
}
