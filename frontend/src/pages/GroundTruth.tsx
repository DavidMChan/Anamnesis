import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { RunConfigCard } from '@/components/surveys/RunConfigCard'
import { supabase } from '@/lib/supabase'
import { mergeEffectiveConfig } from '@/lib/llmConfig'
import { createGroundTruthRun } from '@/lib/surveyRunner'
import {
  parseGroundTruthCsv,
  validRespondents,
  type GroundTruthParseResult,
} from '@/lib/groundTruthCsv'
import { useAuthContext } from '@/contexts/AuthContext'
import type {
  DemographicKey,
  GroundTruthData,
  GroundTruthMatchMethod,
  LLMConfig,
  Survey,
  SurveyAlgorithm,
} from '@/types/database'
import { Upload, Play, Target, AlertCircle, CheckCircle2 } from 'lucide-react'

type GroundTruthAlgorithm = Extract<SurveyAlgorithm, 'anthology' | 'independent'>

export function GroundTruth() {
  const navigate = useNavigate()
  const { user, profile, maskedApiKeys } = useAuthContext()

  const [surveys, setSurveys] = useState<Survey[]>([])
  const [surveyId, setSurveyId] = useState<string>('')
  const [demographicKeys, setDemographicKeys] = useState<DemographicKey[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [parseResult, setParseResult] = useState<GroundTruthParseResult | null>(null)

  const [matchMethod, setMatchMethod] = useState<GroundTruthMatchMethod>('hungarian')
  const [algorithm, setAlgorithm] = useState<GroundTruthAlgorithm>('anthology')
  const [runOverrides, setRunOverrides] = useState<Partial<LLMConfig>>({})

  const [creating, setCreating] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    void fetchSurveys()
    void fetchDemographicKeys()
  }, [user])

  const fetchSurveys = async () => {
    const { data, error } = await supabase
      .from('surveys')
      .select('*')
      .eq('type', 'survey')
      .order('created_at', { ascending: false })
    if (!error && data) setSurveys(data as Survey[])
  }

  const fetchDemographicKeys = async () => {
    const { data, error } = await supabase
      .from('demographic_keys')
      .select('*')
      .eq('status', 'finished')
      .order('display_name')
    if (!error && data) setDemographicKeys(data as DemographicKey[])
  }

  const selectedSurvey = useMemo(
    () => surveys.find((s) => s.id === surveyId) ?? null,
    [surveys, surveyId],
  )

  const knownDemographicKeysSet = useMemo(
    () => new Set(demographicKeys.map((k) => k.key)),
    [demographicKeys],
  )

  const handleFile = async (file: File | null) => {
    setErrorMsg(null)
    if (!file || !selectedSurvey) {
      setFileName('')
      setParseResult(null)
      return
    }
    setFileName(file.name)
    const text = await file.text()
    const result = parseGroundTruthCsv({
      csvText: text,
      knownDemographicKeys: knownDemographicKeysSet,
      surveyQuestions: selectedSurvey.questions,
    })
    setParseResult(result)
  }

  // Reset parsed CSV when survey changes (the question keys/qkeys may differ).
  useEffect(() => {
    setParseResult(null)
    setFileName('')
  }, [surveyId])

  const canRun =
    !!selectedSurvey &&
    !!parseResult &&
    parseResult.fatalError === null &&
    parseResult.stats.validRows > 0

  const startRun = async () => {
    if (!selectedSurvey || !parseResult || !user) return
    setErrorMsg(null)

    if (!profile?.llm_config?.provider && !runOverrides.provider) {
      setErrorMsg('Configure your LLM provider in Settings first.')
      return
    }

    const providerKey = (runOverrides.provider || profile?.llm_config?.provider) as
      | 'openrouter'
      | 'vllm'
      | undefined
    if (providerKey && !maskedApiKeys?.[providerKey]) {
      setErrorMsg(
        `Add your ${providerKey} API key in Settings before running.`,
      )
      return
    }

    const respondents = validRespondents(parseResult)
    const groundTruth: GroundTruthData = {
      mode: parseResult.mode,
      match_method: matchMethod,
      demographic_keys: parseResult.demographicKeys,
      question_keys: parseResult.questionKeys.length > 0
        ? parseResult.questionKeys
        : undefined,
      respondents,
    }

    const llmConfig = mergeEffectiveConfig(profile?.llm_config, runOverrides)

    setCreating(true)
    const result = await createGroundTruthRun({
      surveyId: selectedSurvey.id,
      llmConfig,
      algorithm,
      groundTruth,
    })
    setCreating(false)

    if (!result.success) {
      setErrorMsg(result.error ?? 'Failed to create run')
      return
    }
    navigate(`/surveys/${selectedSurvey.id}/results?run=${result.runId}`)
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Target className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Ground Truth Matching</h1>
            <p className="text-muted-foreground text-sm">
              Upload a CSV of real respondents and match each to the best
              backstory in the pool.
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Step 1: Survey */}
        <Card>
          <CardHeader>
            <CardTitle>1. Survey</CardTitle>
            <CardDescription>
              Pick the survey you want the matched backstories to take. Ground
              truth answer columns in your CSV (prefixed with <code>q</code>)
              should reference qkeys on this survey.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={surveyId} onValueChange={setSurveyId}>
              <SelectTrigger className="w-full md:w-[420px]">
                <SelectValue placeholder="Select a survey" />
              </SelectTrigger>
              <SelectContent>
                {surveys.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name || 'Untitled Survey'} • {s.questions.length}q
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedSurvey && (
              <p className="text-xs text-muted-foreground mt-2">
                qkeys on this survey: {selectedSurvey.questions.map((q) => q.qkey).join(', ')}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Step 2: CSV upload */}
        <Card>
          <CardHeader>
            <CardTitle>2. Respondent CSV</CardTitle>
            <CardDescription>
              Column rules:{' '}
              <code>_id</code> (optional, stable respondent ID);{' '}
              <code>_count</code> (optional, switches the upload to aggregate
              mode);{' '}
              <code>q&lt;qkey&gt;</code> (optional ground truth answers); every
              other column must exactly match a key from{' '}
              <Link to="/demographic-surveys" className="underline">
                Demographics
              </Link>
              . Empty / Refused / NA values drop that dimension for the row.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Label
                htmlFor="gt-csv"
                className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted"
              >
                <Upload className="h-4 w-4" />
                Choose CSV
              </Label>
              <input
                id="gt-csv"
                type="file"
                accept=".csv"
                className="hidden"
                disabled={!selectedSurvey}
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
              <span className="text-sm text-muted-foreground">
                {fileName || (selectedSurvey ? 'No file selected' : 'Select a survey first')}
              </span>
            </div>

            {parseResult && <ParseSummary result={parseResult} />}
          </CardContent>
        </Card>

        {/* Step 3: Matching + algorithm */}
        <Card>
          <CardHeader>
            <CardTitle>3. Matching &amp; Algorithm</CardTitle>
            <CardDescription>
              Hungarian gives optimal one-to-one pairings; greedy is faster but
              may assign one backstory to multiple respondents; random is for
              ablation only. Algorithm controls how the LLM answers each
              question on the matched backstory.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Match method</Label>
              <RadioGroup
                value={matchMethod}
                onValueChange={(v) => setMatchMethod(v as GroundTruthMatchMethod)}
                className="mt-2 flex flex-col gap-2"
              >
                <RadioOption
                  value="hungarian"
                  title="Hungarian"
                  body="Optimal maximum-weight bipartite assignment. One backstory per respondent."
                />
                <RadioOption
                  value="greedy"
                  title="Greedy"
                  body="Each respondent independently picks their best backstory. Backstories may be reused."
                />
                <RadioOption
                  value="random"
                  title="Random"
                  body="Distinct random pairings — ablation baseline."
                />
              </RadioGroup>
            </div>

            <div>
              <Label className="text-sm font-medium">Survey algorithm</Label>
              <RadioGroup
                value={algorithm}
                onValueChange={(v) => setAlgorithm(v as GroundTruthAlgorithm)}
                className="mt-2 flex flex-col gap-2"
              >
                <RadioOption
                  value="anthology"
                  title="Anthology (series with context)"
                  body="Questions asked in order; each call sees the prior Q&A. Matches the anthology paper."
                />
                <RadioOption
                  value="independent"
                  title="Independent"
                  body="Every question answered with only the backstory — no prior Q&A context."
                />
              </RadioGroup>
            </div>
          </CardContent>
        </Card>

        {/* Step 4: LLM config */}
        <RunConfigCard
          profileConfig={profile?.llm_config}
          overrides={runOverrides}
          onChangeOverrides={setRunOverrides}
        />

        <div className="flex items-center justify-end gap-2">
          <Button onClick={startRun} disabled={!canRun || creating}>
            <Play className="h-4 w-4 mr-2" />
            {creating ? 'Starting…' : 'Match & Run'}
          </Button>
        </div>
      </div>
    </Layout>
  )
}

function ParseSummary({ result }: { result: GroundTruthParseResult }) {
  if (result.fatalError) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <span>{result.fatalError}</span>
      </div>
    )
  }

  const { stats } = result
  const droppedCount = Object.keys(stats.droppedDimensions).length

  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1">
          <CheckCircle2 className="h-3 w-3" /> {stats.validRows} valid
        </Badge>
        {stats.errorRows > 0 && (
          <Badge variant="destructive">{stats.errorRows} error</Badge>
        )}
        <Badge variant="secondary">
          {result.mode === 'aggregate'
            ? `aggregate (${stats.totalRespondents} respondents)`
            : 'per respondent'}
        </Badge>
      </div>

      <div className="space-y-1">
        <p>
          <span className="font-medium">Demographic columns matched:</span>{' '}
          {result.demographicKeys.join(', ') || 'none'}
        </p>
        {result.questionKeys.length > 0 && (
          <p>
            <span className="font-medium">Ground truth answers for qkeys:</span>{' '}
            {result.questionKeys.join(', ')}
          </p>
        )}
        {result.unknownHeaders.length > 0 && (
          <p className="text-amber-700 dark:text-amber-400">
            <span className="font-medium">Unknown columns (ignored):</span>{' '}
            {result.unknownHeaders.join(', ')}
          </p>
        )}
        {droppedCount > 0 && (
          <p className="text-amber-700 dark:text-amber-400">
            <span className="font-medium">Refused / empty values dropped:</span>{' '}
            {Object.entries(stats.droppedDimensions)
              .map(([k, n]) => `${k}×${n}`)
              .join(', ')}
          </p>
        )}
      </div>

      {stats.errorRows > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Show row issues
          </summary>
          <ul className="mt-2 space-y-1 max-h-48 overflow-auto">
            {result.rows
              .filter((r) => r.issues.length > 0)
              .map((r) => (
                <li key={r.index}>
                  Row {r.index}:{' '}
                  {r.issues.map((i) => i.message).join('; ')}
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function RadioOption({
  value,
  title,
  body,
}: {
  value: string
  title: string
  body: string
}) {
  return (
    <label
      htmlFor={`gt-radio-${value}`}
      className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/50"
    >
      <RadioGroupItem id={`gt-radio-${value}`} value={value} className="mt-0.5" />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{body}</span>
      </div>
    </label>
  )
}
