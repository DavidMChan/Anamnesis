-- Virtual Personas Arena Database Schema
-- This migration creates the initial tables for the platform

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS table
-- Stores user information and LLM configuration
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    name            TEXT,
    llm_config      JSONB DEFAULT '{}',
    -- Example llm_config:
    -- {
    --   "provider": "openai",
    --   "api_key": "sk-...",
    --   "vllm_endpoint": "http://...",
    --   "model": "gpt-4"
    -- }
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. BACKSTORIES table
-- Stores the shared pool of backstories (with optional privacy)
CREATE TABLE backstories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contributor_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    source_type     TEXT NOT NULL CHECK (source_type IN ('llm_generated', 'human_interview', 'uploaded')),
    backstory_text  TEXT NOT NULL,
    transcript      JSONB,
    -- Interview transcript format:
    -- [{"role": "interviewer", "content": "..."}, {"role": "participant", "content": "..."}]
    demographics    JSONB DEFAULT '{}',
    -- Flexible demographics - can include any fields:
    -- {
    --   "age": 28,
    --   "age_range": "25-34",
    --   "gender": "female",
    --   "party": "democrat",
    --   "education": "college",
    --   "income": "50k-75k",
    --   "race": "white",
    --   "category": "politics",
    --   "custom_tag": "swing_voter"
    -- }
    is_public       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. SURVEYS table
-- Stores user-created surveys with questions and results
CREATE TABLE surveys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT,
    questions       JSONB NOT NULL,
    -- Question format:
    -- [
    --   {"qkey": "q1", "type": "mcq", "text": "...", "options": ["A", "B", "C"]},
    --   {"qkey": "q2", "type": "multiple_select", "text": "...", "options": [...]},
    --   {"qkey": "q3", "type": "open_response", "text": "..."},
    --   {"qkey": "q4", "type": "ranking", "text": "...", "options": [...]}
    -- ]
    demographics    JSONB DEFAULT '{}',
    -- Demographic filter conditions:
    -- {"age": {"min": 18, "max": 35}, "gender": ["female"], "category": ["politics"]}
    results         JSONB DEFAULT '{}',
    -- Results format:
    -- {"backstory_id": {"q1": "A", "q2": ["B", "C"], "q3": "free text..."}, ...}
    matched_count   INTEGER DEFAULT 0,
    completed_count INTEGER DEFAULT 0,
    status          TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'running', 'completed', 'failed')),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX idx_backstories_contributor ON backstories(contributor_id);
CREATE INDEX idx_backstories_is_public ON backstories(is_public);
CREATE INDEX idx_backstories_source_type ON backstories(source_type);
CREATE INDEX idx_backstories_demographics ON backstories USING GIN(demographics);

CREATE INDEX idx_surveys_user ON surveys(user_id);
CREATE INDEX idx_surveys_status ON surveys(status);
CREATE INDEX idx_surveys_created ON surveys(created_at DESC);

-- Row Level Security Policies

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE backstories ENABLE ROW LEVEL SECURITY;
ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own profile
CREATE POLICY "Users can view own profile" ON users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON users
    FOR UPDATE USING (auth.uid() = id);

-- Backstories: Public ones are readable by all, private only by contributor
CREATE POLICY "Anyone can view public backstories" ON backstories
    FOR SELECT USING (is_public = TRUE);

CREATE POLICY "Contributors can view own backstories" ON backstories
    FOR SELECT USING (auth.uid() = contributor_id);

CREATE POLICY "Contributors can insert backstories" ON backstories
    FOR INSERT WITH CHECK (auth.uid() = contributor_id);

CREATE POLICY "Contributors can update own backstories" ON backstories
    FOR UPDATE USING (auth.uid() = contributor_id);

CREATE POLICY "Contributors can delete own backstories" ON backstories
    FOR DELETE USING (auth.uid() = contributor_id);

-- Surveys: Users can only see/modify their own surveys
CREATE POLICY "Users can view own surveys" ON surveys
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own surveys" ON surveys
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own surveys" ON surveys
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own surveys" ON surveys
    FOR DELETE USING (auth.uid() = user_id);

-- Function to create user record on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, name)
    VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create user record when someone signs up
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
