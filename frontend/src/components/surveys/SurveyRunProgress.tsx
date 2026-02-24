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
import { RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, Square, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { SurveyRun, SurveyRunStatus } from '@/types/database'

interface SurveyRunProgressProps {
  run: SurveyRun
  onViewResults?: () => void
  onRunAgain?: () => void
  onCancel?: () => Promise<void>
  creatingRun?: boolean
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

export function SurveyRunProgress({ run, onViewResults, onRunAgain, onCancel, creatingRun }: SurveyRunProgressProps) {
  const [cancelling, setCancelling] = useState(false)
  const status = statusConfig[run.status]
  const totalProcessed = run.completed_tasks + run.failed_tasks
  const progress = run.total_tasks > 0 ? Math.round((totalProcessed / run.total_tasks) * 100) : 0

  const isInProgress = run.status === 'pending' || run.status === 'running'
  const isComplete = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled'

  const handleCancel = async () => {
    if (!onCancel) return
    setCancelling(true)
    try {
      await onCancel()
    } finally {
      setCancelling(false)
    }
  }

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
              {totalProcessed} / {run.total_tasks} ({progress}%)
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
              {run.total_tasks - totalProcessed}
            </div>
            <div className="text-muted-foreground">Remaining</div>
          </div>
        </div>

        {/* Error summary */}
        {run.failed_tasks > 0 && (
          <FailedTaskErrors runId={run.id} failedCount={run.failed_tasks} />
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

const MAX_DISPLAYED_ERRORS = 20

interface FailedTaskError {
  backstory_id: string
  error: string | null
}

function FailedTaskErrors({ runId, failedCount }: { runId: string; failedCount: number }) {
  const [expanded, setExpanded] = useState(false)
  const [errors, setErrors] = useState<FailedTaskError[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (expanded && !loaded) {
      fetchErrors()
    }
  }, [expanded])

  const fetchErrors = async () => {
    const { data } = await supabase
      .from('survey_tasks')
      .select('backstory_id, error')
      .eq('survey_run_id', runId)
      .eq('status', 'failed')
      .limit(MAX_DISPLAYED_ERRORS + 1)

    if (data) {
      setErrors(data as FailedTaskError[])
    }
    setLoaded(true)
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
              {errors.slice(0, MAX_DISPLAYED_ERRORS).map((err, i) => (
                <div key={i} className="text-xs rounded border border-destructive/10 bg-background p-2">
                  <span className="font-mono text-muted-foreground">
                    {err.backstory_id.slice(0, 8)}...
                  </span>
                  <span className="mx-2 text-destructive/40">|</span>
                  <span className="text-destructive">{err.error || 'Unknown error'}</span>
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
