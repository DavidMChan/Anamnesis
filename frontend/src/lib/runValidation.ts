import type { Survey, LLMConfig, DemographicSelectionConfig, SurveyAlgorithm, AdaptiveSamplingConfig } from '@/types/database'

export interface RunValidationResult {
  valid: boolean
  error?: string
}

interface ValidateRunConfigOptions {
  survey: Survey
  llmConfig: LLMConfig | undefined
  maskedApiKeys: { openrouter: string | null; vllm: string | null }
  demographics: DemographicSelectionConfig
  algorithm: SurveyAlgorithm
  adaptiveSampling: AdaptiveSamplingConfig
}

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

export async function validateRunConfig({
  survey,
  llmConfig,
  maskedApiKeys,
  demographics,
  algorithm,
  adaptiveSampling,
}: ValidateRunConfigOptions): Promise<RunValidationResult> {
  const sampleSize = demographics.sample_size

  if (algorithm === 'zero_shot_baseline' && (!sampleSize || sampleSize <= 0)) {
    return { valid: false, error: 'Number of trials must be greater than 0 for zero-shot baseline.' }
  }

  if (adaptiveSampling.enabled && sampleSize > 0 && sampleSize < adaptiveSampling.min_samples) {
    return { valid: false, error: 'Maximum samples must be at least the minimum samples for run-until-stable mode.' }
  }

  if (!llmConfig?.provider) {
    return { valid: false, error: 'No LLM provider configured. Set up your LLM settings in the Settings page.' }
  }

  if (llmConfig.provider === 'openrouter') {
    if (!maskedApiKeys.openrouter) {
      return { valid: false, error: 'OpenRouter API key is missing. Add your API key in the Settings page.' }
    }
    if (!llmConfig.openrouter_model) {
      return { valid: false, error: 'OpenRouter model is not set. Configure it in the Settings page.' }
    }
  } else if (llmConfig.provider === 'vllm') {
    if (!llmConfig.vllm_endpoint) {
      return { valid: false, error: 'vLLM endpoint is not set. Configure it in the Settings page.' }
    }
    if (!llmConfig.vllm_model) {
      return { valid: false, error: 'vLLM model is not set. Configure it in the Settings page.' }
    }
  }

  const hasMedia = survey.questions.some(
    (q) => q.media || q.option_media?.some((m) => m != null)
  )

  if (hasMedia) {
    const modelId = llmConfig.provider === 'openrouter' ? llmConfig.openrouter_model : llmConfig.vllm_model
    const isMultimodal = await checkMultimodalSupport(modelId || '')
    if (!isMultimodal) {
      return {
        valid: false,
        error: `Model (${modelId}) may not support multimodal input. This survey has media attachments. Use a multimodal model (e.g., google/gemini-2.0-flash, anthropic/claude-sonnet-4, openai/gpt-4o).`,
      }
    }
  }

  return { valid: true }
}
