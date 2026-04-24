export interface User {
  id: string
  email: string
  name: string | null
  llm_config: LLMConfig
  created_at: string
}

export interface LLMConfig {
  // Provider selection
  provider?: 'openrouter' | 'vllm'

  // OpenRouter settings
  openrouter_model?: string  // e.g., "anthropic/claude-3-haiku"

  // vLLM settings
  vllm_endpoint?: string     // e.g., "http://localhost:8000/v1"
  vllm_model?: string        // e.g., "meta-llama/Llama-3-70b"

  // Generation settings
  temperature?: number       // e.g., 0.0
  max_tokens?: number        // e.g., 512

  // Inference mode
  use_chat_template?: boolean    // Use /v1/chat/completions instead of /v1/completions
  // vLLM-specific inference settings
  use_guided_decoding?: boolean  // Enable vLLM guided decoding for MCQ parsing

  // Parser LLM (Tier 2 fallback for MCQ parsing via OpenRouter)
  parser_llm_model?: string  // e.g., "google/gemini-2.0-flash-001"

  // Concurrency control (enforced by dispatcher)
  max_concurrent_tasks?: number  // Default: 10

  // Adaptive sampling control. When enabled, the dispatcher may finish a run
  // before all pre-created tasks are consumed once closed-choice answers have
  // a stable posterior ranking.
  adaptive_sampling?: AdaptiveSamplingConfig

  // Demographic survey execution params (stored in run snapshot)
  distribution_mode?: 'n_sample' | 'logprobs'
  num_trials?: number  // N-sample mode: how many times per backstory

  // Note: API keys are stored securely in Supabase Vault, not in this config
}

export interface AdaptiveSamplingConfig {
  enabled: boolean
  epsilon: number
  min_samples: number
  stop_summary?: AdaptiveSamplingStopSummary
}

export interface AdaptiveSamplingStopSummary {
  sample_count: number
  eligible_questions: number
  confidence_lower_bound: number
  epsilon: number
  min_samples: number
  stopped_at?: string
}

export interface Backstory {
  id: string
  vuid: string | null
  contributor_id: string | null
  source_type: 'llm_generated' | 'human_interview' | 'uploaded' | 'anthology' | 'alterity'
  backstory_text: string
  transcript: TranscriptMessage[] | null
  demographics: Demographics
  is_public: boolean
  created_at: string
}

export interface TranscriptMessage {
  role: 'interviewer' | 'participant'
  content: string
}

// Each demographic dimension stores a top choice and probability distribution
export interface DemographicDimension {
  value: string | null
  distribution: Record<string, number>
}

// Backstory demographics: keyed by dimension (e.g., "c_age", "c_gender")
export interface Demographics {
  [key: string]: DemographicDimension
}

// Survey filter: match backstories by their demographic value field
export interface DemographicFilter {
  [key: string]: string[] | { min?: number; max?: number } | undefined
}

// New config stored in survey_runs.demographics for distribution-based selection
export type DemographicSelectionMode = 'top_k' | 'balanced'

export interface DemographicSelectionConfig {
  mode: DemographicSelectionMode
  sample_size: number
  filters: DemographicFilter
  // Balanced mode only: pipe-delimited group keys → slot counts
  slot_allocation?: Record<string, number>
  // Ordered dimension keys for serializing/deserializing group keys
  dimensions?: string[]
}

// Metadata about demographic keys
export type DemographicValueType = 'numeric' | 'enum' | 'text'

export type DemographicKeyStatus = 'pending' | 'running' | 'finished' | 'failed'
export type DistributionMode = 'n_sample' | 'logprobs'

export interface DemographicKey {
  key: string
  display_name: string
  value_type: DemographicValueType
  enum_values: string[] | null
  status: DemographicKeyStatus
  created_by: string | null
  created_at: string
}

export type QuestionType = 'mcq' | 'multiple_select' | 'open_response' | 'ranking'

export interface MediaAttachment {
  key: string       // Wasabi object key (e.g., "media/abc123.png")
  type: string      // MIME type (e.g., "image/png", "audio/wav")
  name: string      // Original filename for display
}

export interface Question {
  qkey: string
  type: QuestionType
  text: string
  options?: string[]
  media?: MediaAttachment               // Question-level attachment
  option_media?: (MediaAttachment | null)[]  // Per-option, parallel to options[]
}

export interface SurveyTaskUsage {
  api_calls: number
  main_model_calls: number
  parser_model_calls: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  reasoning_tokens: number
  cached_tokens: number
  cache_write_tokens: number
  audio_tokens: number
  cost: number
  main_model_cost: number
  parser_model_cost: number
}

export interface SurveyTaskMeta {
  llm?: {
    provider?: string | null
    model?: string | null
  } | null
  parser_llm?: {
    model?: string | null
  } | null
  usage?: SurveyTaskUsage | null
}

export type SurveyTaskResult = Record<string, string | string[] | undefined> & {
  __meta__?: SurveyTaskMeta
}

export type SurveyStatus = 'draft' | 'active'
export type SurveyType = 'survey' | 'demographic'

export interface SurveyResults {
  [backstory_id: string]: SurveyTaskResult
}

export interface Survey {
  id: string
  user_id: string
  name?: string
  questions: Question[]
  demographics: DemographicFilter
  status: SurveyStatus
  type: SurveyType
  demographic_key?: string | null  // For type='demographic': which key this survey populates
  created_at: string
}

// Survey Run Types
export type SurveyRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type SurveyAlgorithm = 'anthology' | 'zero_shot_baseline'

export interface SurveyRunErrorLog {
  backstory_id: string
  error: string
  timestamp: string
}

export interface SurveyRun {
  id: string
  survey_id: string
  status: SurveyRunStatus
  total_tasks: number
  completed_tasks: number
  failed_tasks: number
  results?: SurveyResults
  error_log?: SurveyRunErrorLog[]
  llm_config: LLMConfig
  demographics?: DemographicFilter | DemographicSelectionConfig
  algorithm: SurveyAlgorithm
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export type SurveyTaskStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'

export interface SurveyTask {
  id: string
  survey_run_id: string
  backstory_id: string | null
  status: SurveyTaskStatus
  result: SurveyTaskResult | null
  error: string | null
  attempts: number
  created_at: string
  processed_at: string | null
}

export interface Database {
  public: {
    Tables: {
      users: {
        Row: User
        Insert: Omit<User, 'id' | 'created_at'>
        Update: Partial<Omit<User, 'id' | 'created_at'>>
      }
      backstories: {
        Row: Backstory
        Insert: Omit<Backstory, 'id' | 'created_at'>
        Update: Partial<Omit<Backstory, 'id' | 'created_at'>>
      }
      surveys: {
        Row: Survey
        Insert: Omit<Survey, 'id' | 'created_at'>
        Update: Partial<Omit<Survey, 'id' | 'created_at'>>
      }
      survey_runs: {
        Row: SurveyRun
        Insert: Omit<SurveyRun, 'id' | 'created_at'>
        Update: Partial<Omit<SurveyRun, 'id' | 'created_at'>>
      }
      survey_tasks: {
        Row: SurveyTask
        Insert: Omit<SurveyTask, 'id' | 'created_at'>
        Update: Partial<Omit<SurveyTask, 'id' | 'created_at'>>
      }
    }
  }
}
