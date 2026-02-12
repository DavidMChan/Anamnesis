export interface User {
  id: string
  email: string
  name: string | null
  llm_config: LLMConfig
  created_at: string
}

export interface LLMConfig {
  provider?: 'openai' | 'anthropic' | 'together' | 'vllm'
  api_key?: string
  vllm_endpoint?: string
  model?: string
}

export interface Backstory {
  id: string
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

// Backstory stores specific values
export interface Demographics {
  age?: number
  gender?: string
  party?: string
  education?: string
  income?: number
  race?: string
  religion?: string
  region?: string
  [key: string]: string | number | undefined
}

// Survey filter stores conditions (ranges for numeric, arrays for enum)
export interface DemographicFilter {
  [key: string]: { min?: number; max?: number } | string[] | undefined
}

// Metadata about demographic keys
export type DemographicValueType = 'numeric' | 'enum' | 'text'

export interface DemographicKey {
  key: string
  display_name: string
  value_type: DemographicValueType
  enum_values: string[] | null
  created_at: string
}

export type QuestionType = 'mcq' | 'multiple_select' | 'open_response' | 'ranking'

export interface Question {
  qkey: string
  type: QuestionType
  text: string
  options?: string[]
  image_url?: string
}

export type SurveyStatus = 'draft' | 'active'

export interface SurveyResults {
  [backstory_id: string]: {
    [qkey: string]: string | string[]
  }
}

export interface Survey {
  id: string
  user_id: string
  name?: string
  questions: Question[]
  demographics: DemographicFilter
  status: SurveyStatus
  created_at: string
}

// Survey Run Types
export type SurveyRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

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
  results: SurveyResults
  error_log: SurveyRunErrorLog[]
  llm_config: LLMConfig
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export type SurveyTaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface SurveyTask {
  id: string
  survey_run_id: string
  backstory_id: string
  status: SurveyTaskStatus
  result: { [qkey: string]: string | string[] } | null
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
