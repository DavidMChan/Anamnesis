/**
 * Survey run progress display component.
 * Shows real-time progress of a survey run.
 */
import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, Square, ChevronDown, RotateCcw, Wallet, Gauge, Flag, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { retryTask } from '@/lib/surveyRunner'
import { computeAdaptiveSamplingSummary, type AdaptiveSamplingSummary } from '@/lib/bayesianStability'
import type { SurveyRun, SurveyRunStatus, SurveyTaskUsage, SurveyTaskResult, SurveyResults as SurveyResultsType, Question } from '@/types/database'

interface SurveyRunProgressProps {
  run: SurveyRun
  onViewResults?: () => void
  onRunAgain?: () => void
  onCancel?: () => Promise<void>
  creatingRun?: boolean
  /** Called after any task is retried so the parent can refresh run data */
  onTaskRetried?: () => void
}

const statusConfig: Record<
  SurveyRunStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }
> = {
  pending: {
    label: 'Pending',
    variant: 'outline',
    icon: <Clock className="h-4 w-4" />,
  },
  running: {
    label: 'Running',
    variant: 'default',
    icon: <RefreshCw className="h-4 w-4 animate-spin" />,
  },
  completed: {
    label: 'Completed',
    variant: 'default',
    icon: <CheckCircle className="h-4 w-4" />,
  },
  failed: {
    label: 'Failed',
    variant: 'destructive',
    icon: <XCircle className="h-4 w-4" />,
  },
  cancelled: {
    label: 'Cancelled',
    variant: 'secondary',
    icon: <AlertTriangle className="h-4 w-4" />,
  },
}

export function SurveyRunProgress({ run, onViewResults, onRunAgain, onCancel, creatingRun, onTaskRetried }: SurveyRunProgressProps) {
  const [cancelling, setCancelling] = useState(false)
  const [costSummary, setCostSummary] = useState<SurveyTaskUsage | null>(null)
  const [earlyStoppingSummary, setEarlyStoppingSummary] = useState<AdaptiveSamplingSummary | null>(null)
  const status = statusConfig[run.status]
  const totalProcessed = run.completed_tasks + run.failed_tasks
  const isInProgress = run.status === 'pending' || run.status === 'running'
  const isComplete = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled'
  const isSuccessfulCompletion = run.status === 'completed'
  const adaptiveConfig = run.llm_config.adaptive_sampling
  const showEarlyStopping = adaptiveConfig?.enabled === true
  const displayTotalTasks = isSuccessfulCompletion ? totalProcessed : run.total_tasks
  const progress = isSuccessfulCompletion
    ? 100
    : run.total_tasks > 0
      ? Math.round((totalProcessed / run.total_tasks) * 100)
      : 0
  const remainingTasks = isSuccessfulCompletion ? 0 : Math.max(0, run.total_tasks - totalProcessed)

  const handleCancel = async () => {
    if (!onCancel) return
    setCancelling(true)
    try {
      await onCancel()
    } finally {
      setCancelling(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const fetchCostSummary = async () => {
      const { data, error } = await supabase
        .from('survey_tasks')
        .select('id, backstory_id, result')
        .eq('survey_run_id', run.id)
        .eq('status', 'completed')

      if (cancelled || error) return

      const totals = aggregateUsageFromResults((data || []).map((row) => row.result as SurveyTaskResult | null))
      setCostSummary(totals)

      if (showEarlyStopping && !adaptiveConfig?.stop_summary) {
        const { data: surveyData } = await supabase
          .from('surveys')
          .select('questions')
          .eq('id', run.survey_id)
          .single()

        if (cancelled || !surveyData) return

        const taskResults: SurveyResultsType = {}
        for (const task of data || []) {
          if (task.result) {
            taskResults[task.backstory_id ?? task.id] = task.result as SurveyTaskResult
          }
        }
        setEarlyStoppingSummary(
          computeAdaptiveSamplingSummary(surveyData.questions as Question[], taskResults, {
            epsilon: adaptiveConfig?.epsilon ?? 0.01,
            minSamples: adaptiveConfig?.min_samples ?? 30,
          })
        )
      }
    }

    fetchCostSummary()
    if (isInProgress) {
      const intervalId = setInterval(fetchCostSummary, 5000)
      return () => {
        cancelled = true
        clearInterval(intervalId)
      }
    }

    return () => {
      cancelled = true
    }
  }, [run.id, run.survey_id, run.completed_tasks, isInProgress, showEarlyStopping, adaptiveConfig])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {status.icon}
            <CardTitle>Survey Run</CardTitle>
          </div>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <CardDescription>
          {isInProgress ? 'Processing backstories...' : formatCompletionTime(run)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Progress</span>
            <span className="text-muted-foreground">
              {totalProcessed} / {displayTotalTasks} ({progress}%)
            </span>
          </div>
          <Progress value={progress} className="h-2" />
          {isInProgress && run.started_at && totalProcessed >= 3 && (
            <p className="text-xs text-muted-foreground text-right">
              ~{estimateEta(run)} remaining
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">{run.completed_tasks}</div>
            <div className="text-muted-foreground">Completed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-destructive">{run.failed_tasks}</div>
            <div className="text-muted-foreground">Failed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">
              {remainingTasks}
            </div>
            <div className="text-muted-foreground">Remaining</div>
          </div>
        </div>

        {((costSummary && run.completed_tasks > 0) || showEarlyStopping) && (
          <div className={`grid gap-4 ${costSummary && run.completed_tasks > 0 && showEarlyStopping ? 'md:grid-cols-[2fr_1fr]' : 'grid-cols-1'}`}>
            {costSummary && run.completed_tasks > 0 && (
              <div className="h-full rounded-xl border border-border/70 bg-gradient-to-r from-card to-muted/40 p-4">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      {isInProgress ? 'Estimated Cost' : 'Run Cost'}
                    </div>
                    <div className="mt-1 text-2xl font-semibold leading-none">
                      {formatUsd(isInProgress ? (costSummary.cost / run.completed_tasks) * run.total_tasks : costSummary.cost)}
                    </div>
                    {/* <div className="mt-1 text-sm text-muted-foreground">
                      pace for the full run
                    </div> */}
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {run.completed_tasks} task{run.completed_tasks > 1 ? 's' : ''} sampled
                  </Badge>
                </div>
                <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                  <div className="rounded-lg border border-border/60 bg-background/80 p-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Wallet className="h-4 w-4" />
                      <span>Current cost</span>
                    </div>
                    <div className="mt-2 text-lg font-medium">{formatUsd(costSummary.cost)}</div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background/80 p-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Gauge className="h-4 w-4" />
                      <span>Cost per completed task</span>
                    </div>
                    <div className="mt-2 text-lg font-medium">{formatUsd(costSummary.cost / run.completed_tasks)}</div>
                    {/* <div className="text-xs text-muted-foreground">per completed task</div> */}
                  </div>
                </div>
                {isInProgress && (
                  <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Flag className="h-3.5 w-3.5" />
                    This line moves with each completed task that reports usage metadata.
                  </p>
                )}
              </div>
            )}
            {showEarlyStopping && (
              <EarlyStoppingRunCard run={run} summary={earlyStoppingSummary} />
            )}
          </div>
        )}

        {/* Error summary */}
        {run.failed_tasks > 0 && (
          <FailedTaskErrors runId={run.id} failedCount={run.failed_tasks} onTaskRetried={onTaskRetried} />
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {run.completed_tasks > 0 && onViewResults && (
            <Button onClick={onViewResults} className="flex-1">
              {isInProgress ? 'View Partial Results' : 'View Results'}
            </Button>
          )}
          {isInProgress && onCancel && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={cancelling}>
                  <Square className="h-4 w-4 mr-2" />
                  {cancelling ? 'Stopping...' : 'Stop Run'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Stop this survey run?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Tasks already in progress will finish, but no new tasks will be started.
                    You can start a new run afterwards.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleCancel}>
                    Stop Run
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {isComplete && onRunAgain && (
            <Button variant="outline" onClick={onRunAgain} disabled={creatingRun}>
              {creatingRun ? 'Starting...' : 'Run Again'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function aggregateUsageFromResults(results: Array<SurveyTaskResult | null>): SurveyTaskUsage | null {
  const totals: SurveyTaskUsage = {
    api_calls: 0,
    main_model_calls: 0,
    parser_model_calls: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    cache_write_tokens: 0,
    audio_tokens: 0,
    cost: 0,
    main_model_cost: 0,
    parser_model_cost: 0,
  }

  let seen = false
  for (const result of results) {
    const usage = result?.__meta__?.usage
    if (!usage) continue
    seen = true
    ;(Object.keys(totals) as (keyof SurveyTaskUsage)[]).forEach((key) => {
      totals[key] += usage[key] || 0
    })
  }

  return seen ? totals : null
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`
}

function EarlyStoppingRunCard({ run, summary }: { run: SurveyRun; summary: AdaptiveSamplingSummary | null }) {
  const adaptiveConfig = run.llm_config.adaptive_sampling
  if (!adaptiveConfig?.enabled) return null

  const stopSummary = adaptiveConfig.stop_summary
  const confidence = stopSummary?.confidence_lower_bound ?? summary?.confidenceLowerBound
  const sampleCount = stopSummary?.sample_count ?? summary?.sampleCount
  const badgeLabel = run.status === 'completed'
    ? 'Completed'
    : confidence !== undefined
      ? 'Stable'
      : 'Monitoring'

  return (
    <div className="h-full rounded-xl border border-border/70 bg-gradient-to-r from-card to-muted/40 p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Early Stopping</div>
          <div className="mt-1 text-2xl font-semibold leading-none">
            {confidence !== undefined ? `${Math.round(confidence * 1000) / 10}%` : 'Calculating'}
          </div>
        </div>
        <Badge variant={run.status === 'completed' || confidence !== undefined ? 'default' : 'outline'} className="shrink-0">
          {badgeLabel}
        </Badge>
      </div>
      <div className="rounded-lg border border-border/60 bg-background/80 p-3 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <CheckCircle2 className="h-4 w-4" />
          <span>Samples evaluated</span>
        </div>
        <div className="mt-2 text-lg font-medium">
          {sampleCount !== undefined ? sampleCount : 'Calculating'}
        </div>
      </div>
    </div>
  )
}

const MAX_DISPLAYED_ERRORS = 20

interface FailedTaskError {
  id: string
  backstory_id: string
  error: string | null
}

function FailedTaskErrors({
  runId,
  failedCount,
  onTaskRetried,
}: {
  runId: string
  failedCount: number
  onTaskRetried?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [errors, setErrors] = useState<FailedTaskError[]>([])
  const [loaded, setLoaded] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  useEffect(() => {
    if (expanded && !loaded) {
      fetchErrors()
    }
  }, [expanded])

  const fetchErrors = async () => {
    const { data } = await supabase
      .from('survey_tasks')
      .select('id, backstory_id, error')
      .eq('survey_run_id', runId)
      .eq('status', 'failed')
      .limit(MAX_DISPLAYED_ERRORS + 1)

    if (data) {
      setErrors(data as FailedTaskError[])
    }
    setLoaded(true)
  }

  const handleRetry = async (taskId: string) => {
    setRetryingId(taskId)
    try {
      await retryTask(taskId)
      // Remove from local list immediately
      setErrors((prev) => prev.filter((e) => e.id !== taskId))
      onTaskRetried?.()
    } catch (e) {
      console.error('Failed to retry task:', e)
    } finally {
      setRetryingId(null)
    }
  }

  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
      <button
        type="button"
        className="flex items-center justify-between w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-sm font-medium text-destructive">
          {failedCount} task{failedCount > 1 ? 's' : ''} failed
        </span>
        <ChevronDown className={`h-4 w-4 text-destructive transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="mt-3 space-y-2">
          {!loaded ? (
            <p className="text-xs text-muted-foreground">Loading errors...</p>
          ) : errors.length === 0 ? (
            <p className="text-xs text-muted-foreground">No error details available</p>
          ) : (
            <>
              {errors.slice(0, MAX_DISPLAYED_ERRORS).map((err) => (
                <div key={err.id} className="text-xs rounded border border-destructive/10 bg-background p-2 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-muted-foreground">
                      {err.backstory_id ? `${err.backstory_id.slice(0, 8)}...` : err.id.slice(0, 8)}
                    </span>
                    <span className="mx-2 text-destructive/40">|</span>
                    <span className="text-destructive">{err.error || 'Unknown error'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRetry(err.id)}
                    disabled={retryingId === err.id}
                    className="shrink-0 flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                    title="Retry this task"
                  >
                    <RotateCcw className={`h-3 w-3 ${retryingId === err.id ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              ))}
              {failedCount > MAX_DISPLAYED_ERRORS && (
                <p className="text-xs text-muted-foreground">
                  and {failedCount - MAX_DISPLAYED_ERRORS} more...
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function estimateEta(run: SurveyRun): string {
  const elapsed = Date.now() - new Date(run.started_at!).getTime()
  const processed = run.completed_tasks + run.failed_tasks
  if (processed === 0 || elapsed <= 0) return 'calculating...'
  const msPerTask = elapsed / processed
  const remaining = run.total_tasks - processed
  return formatDuration(Math.round(msPerTask * remaining))
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

function formatCompletionTime(run: SurveyRun): string {
  if (run.status === 'pending') {
    return 'Waiting to start...'
  }
  if (run.status === 'running') {
    if (run.started_at) {
      const started = new Date(run.started_at)
      return `Started ${formatRelativeTime(started)}`
    }
    return 'Running...'
  }
  if (run.started_at && run.completed_at) {
    const duration = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
    return `Completed in ${formatDuration(duration)}`
  }
  if (run.completed_at) {
    return `Finished ${formatRelativeTime(new Date(run.completed_at))}`
  }
  return ''
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

interface SurveyRunHistoryProps {
  runs: SurveyRun[]
  onSelectRun?: (run: SurveyRun) => void
}

export function SurveyRunHistory({ runs, onSelectRun }: SurveyRunHistoryProps) {
  if (runs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Run History</CardTitle>
          <CardDescription>No runs yet. Click "Run Survey" to start.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run History</CardTitle>
        <CardDescription>{runs.length} run{runs.length > 1 ? 's' : ''}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {runs.map((run) => {
            const status = statusConfig[run.status]
            const progress =
              run.total_tasks > 0
                ? Math.round(((run.completed_tasks + run.failed_tasks) / run.total_tasks) * 100)
                : 0

            return (
              <div
                key={run.id}
                className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent cursor-pointer"
                onClick={() => onSelectRun?.(run)}
              >
                <div className="flex items-center gap-3">
                  {status.icon}
                  <div>
                    <div className="text-sm font-medium">
                      {new Date(run.started_at || run.created_at).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', year: 'numeric',
                        hour: 'numeric', minute: '2-digit',
                      })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {run.completed_tasks}/{run.total_tasks} completed
                      {run.started_at && run.completed_at && (
                        <> &middot; {formatDuration(new Date(run.completed_at).getTime() - new Date(run.started_at).getTime())}</>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={status.variant} className="text-xs">
                    {progress}%
                  </Badge>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
