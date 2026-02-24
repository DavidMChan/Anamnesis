import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { useAuthContext } from '@/contexts/AuthContext'
import { DemographicKeyForm, type DemographicKeyFormData } from '@/components/demographic-surveys/DemographicKeyForm'
import { createDemographicSurveyRun } from '@/lib/surveyRunner'
import { mergeEffectiveConfig } from '@/lib/llmConfig'
import { toast } from '@/hooks/use-toast'
import { ArrowLeft, Play } from 'lucide-react'

const defaultFormData: DemographicKeyFormData = {
  key: '',
  displayName: '',
  valueType: 'enum',
  enumValues: [],
  distributionMode: 'n_sample',
  numTrials: 20,
  question: {
    qkey: 'demographic_q',
    type: 'mcq',
    text: '',
  },
}

export function DemographicSurveyCreate() {
  const navigate = useNavigate()
  const { user, profile, maskedApiKeys } = useAuthContext()
  const [formData, setFormData] = useState<DemographicKeyFormData>(defaultFormData)
  const [existingKeys, setExistingKeys] = useState<string[]>([])
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
    if (!formData.key) errors.key = 'Key is required'
    if (/[^a-z0-9_]/.test(formData.key)) errors.key = 'Only lowercase letters, numbers, and underscores'
    if (existingKeys.includes(formData.key)) errors.key = 'This key already exists'
    if (!formData.displayName) errors.displayName = 'Display name is required'
    if (formData.valueType === 'enum' && formData.enumValues.length < 2) {
      errors.enumValues = 'At least 2 enum values required'
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

    setSubmitting(true)

    try {
      // 1. Create the demographic_keys row with status = 'running'
      const { error: dkError } = await supabase
        .from('demographic_keys')
        .insert({
          key: formData.key,
          display_name: formData.displayName,
          value_type: formData.valueType,
          enum_values: formData.valueType === 'enum' ? formData.enumValues : null,
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
        ...mergeEffectiveConfig(llmConfig, {}),
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
              Define a demographic key and run a survey to determine it for all backstories
            </p>
          </div>
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
