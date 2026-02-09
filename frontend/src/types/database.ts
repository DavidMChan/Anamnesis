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
  source_type: 'llm_generated' | 'human_interview' | 'uploaded'
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

export type SurveyStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed'

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
  results: SurveyResults
  status: SurveyStatus
  matched_count?: number
  completed_count?: number
  created_at: string
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
    }
  }
}
