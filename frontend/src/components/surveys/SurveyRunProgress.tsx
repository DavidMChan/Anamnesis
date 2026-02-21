/**
 * Survey run progress display component.
 * Shows real-time progress of a survey run.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react'
import type { SurveyRun, SurveyRunStatus } from '@/types/database'

interface SurveyRunProgressProps {
  run: SurveyRun
  onViewResults?: () => void
  onRunAgain?: () => void
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

export function SurveyRunProgress({ run, onViewResults, onRunAgain }: SurveyRunProgressProps) {
  const status = statusConfig[run.status]
  const totalProcessed = run.completed_tasks + run.failed_tasks
  const progress = run.total_tasks > 0 ? Math.round((totalProcessed / run.total_tasks) * 100) : 0

  const isInProgress = run.status === 'pending' || run.status === 'running'
  const isComplete = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled'

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
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
            <div className="text-sm font-medium text-destructive">
              {run.failed_tasks} task{run.failed_tasks > 1 ? 's' : ''} failed
            </div>
          </div>
        )}

        {/* Actions */}
        {isComplete && (
          <div className="flex gap-2">
            {run.completed_tasks > 0 && onViewResults && (
              <Button onClick={onViewResults} className="flex-1">
                View Results
              </Button>
            )}
            {onRunAgain && (
              <Button variant="outline" onClick={onRunAgain}>
                Run Again
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
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
                      {new Date(run.created_at).toLocaleDateString()}
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
