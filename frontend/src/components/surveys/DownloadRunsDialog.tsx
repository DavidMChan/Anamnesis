import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { supabase } from '@/lib/supabase'
import { getModelName } from '@/lib/llmConfig'
import type { Survey, SurveyRun } from '@/types/database'
import { Loader2 } from 'lucide-react'

export interface RunPick {
  survey: Survey
  run: SurveyRun
}

interface DownloadRunsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  surveys: Survey[]
  selectedSurveyIds: Set<string>
  onConfirm: (picks: RunPick[]) => void
}

export function DownloadRunsDialog({
  open,
  onOpenChange,
  surveys,
  selectedSurveyIds,
  onConfirm,
}: DownloadRunsDialogProps) {
  const [loading, setLoading] = useState(false)
  const [runs, setRuns] = useState<SurveyRun[]>([])
  const [pickedRunIds, setPickedRunIds] = useState<Set<string>>(new Set())

  const surveysById = useMemo(
    () => new Map(surveys.map((s) => [s.id, s])),
    [surveys],
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      const { data } = await supabase
        .from('survey_runs')
        .select('*')
        .in('survey_id', Array.from(selectedSurveyIds))
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
      if (cancelled) return
      const fetched = (data ?? []) as SurveyRun[]
      setRuns(fetched)
      // Pre-check the latest run per survey.
      const latestPerSurvey = new Map<string, string>()
      for (const r of fetched) {
        if (!latestPerSurvey.has(r.survey_id)) {
          latestPerSurvey.set(r.survey_id, r.id)
        }
      }
      setPickedRunIds(new Set(latestPerSurvey.values()))
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [open, selectedSurveyIds])

  const runsBySurvey = useMemo(() => {
    const map = new Map<string, SurveyRun[]>()
    for (const r of runs) {
      const list = map.get(r.survey_id) ?? []
      list.push(r)
      map.set(r.survey_id, list)
    }
    return map
  }, [runs])

  const togglePick = (id: string) =>
    setPickedRunIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectAllLatest = () => {
    const next = new Set<string>()
    for (const list of runsBySurvey.values()) {
      if (list[0]) next.add(list[0].id)
    }
    setPickedRunIds(next)
  }

  const selectAll = () => setPickedRunIds(new Set(runs.map((r) => r.id)))
  const selectNone = () => setPickedRunIds(new Set())

  const confirm = () => {
    const picks: RunPick[] = []
    for (const [surveyId, list] of runsBySurvey) {
      const survey = surveysById.get(surveyId)
      if (!survey) continue
      for (const run of list) {
        if (pickedRunIds.has(run.id)) picks.push({ survey, run })
      }
    }
    onConfirm(picks)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pick runs to download</DialogTitle>
          <DialogDescription>
            One CSV per checked run. Latest run per survey is pre-selected.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs">
          <Button variant="outline" size="sm" onClick={selectAllLatest}>
            All latest
          </Button>
          <Button variant="outline" size="sm" onClick={selectAll}>
            All runs
          </Button>
          <Button variant="outline" size="sm" onClick={selectNone}>
            None
          </Button>
          <span className="ml-auto text-muted-foreground">
            {pickedRunIds.size} / {runs.length} selected
          </span>
        </div>

        <div className="max-h-[50vh] overflow-y-auto rounded-md border divide-y">
          {loading && (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading runs…
            </div>
          )}

          {!loading && runs.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No completed runs for the selected surveys.
            </p>
          )}

          {!loading &&
            Array.from(runsBySurvey.entries()).map(([surveyId, list]) => {
              const survey = surveysById.get(surveyId)
              return (
                <div key={surveyId} className="p-3">
                  <div className="mb-2 text-sm font-medium">
                    {survey?.name || 'Untitled Survey'}{' '}
                    <span className="text-xs text-muted-foreground">
                      ({list.length} run{list.length !== 1 ? 's' : ''})
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {list.map((run, idx) => {
                      const model = getModelName(run.llm_config) ?? 'unknown'
                      const completion =
                        run.total_tasks > 0
                          ? Math.round((run.completed_tasks / run.total_tasks) * 100)
                          : 0
                      const date = run.completed_at ?? run.started_at ?? run.created_at
                      return (
                        <li
                          key={run.id}
                          className="flex items-center gap-3 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50"
                        >
                          <Checkbox
                            id={`run-${run.id}`}
                            checked={pickedRunIds.has(run.id)}
                            onCheckedChange={() => togglePick(run.id)}
                          />
                          <label
                            htmlFor={`run-${run.id}`}
                            className="flex flex-1 cursor-pointer items-center gap-3"
                          >
                            <span className="font-mono text-muted-foreground">
                              {formatDate(date)}
                            </span>
                            <span>{run.algorithm}</span>
                            <span className="text-muted-foreground">{model}</span>
                            <span className="ml-auto text-muted-foreground">
                              {completion}% · {run.completed_tasks}/{run.total_tasks}
                            </span>
                            {idx === 0 && (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                latest
                              </span>
                            )}
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={pickedRunIds.size === 0}>
            Download {pickedRunIds.size} CSV{pickedRunIds.size !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
