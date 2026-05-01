import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Survey, SurveyRun } from '@/types/database'
import { getModelName } from '@/lib/llmConfig'
import { isDemographicSelectionConfig } from '@/lib/backstoryFilters'
import { Eye, BarChart3, Trash2, Copy } from 'lucide-react'

const runStatusVariants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' | 'gold'> = {
  pending: 'warning',
  running: 'gold',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'outline',
}

const surveyStatusVariants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' | 'gold'> = {
  draft: 'secondary',
  active: 'gold',
}

interface SurveyListTableProps {
  surveys: Survey[]
  latestRunStatus: Record<string, string>
  latestRuns: Record<string, SurveyRun>
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onDeleteSurvey: (id: string) => void
  onDuplicateSurvey: (survey: Survey) => void
}

export function SurveyListTable({
  surveys,
  latestRunStatus,
  latestRuns,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onDeleteSurvey,
  onDuplicateSurvey,
}: SurveyListTableProps) {
  const allSelected = surveys.length > 0 && surveys.every((s) => selectedIds.has(s.id))
  const someSelected = surveys.some((s) => selectedIds.has(s.id))

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) => {
                  if (checked) {
                    onSelectAll()
                  } else {
                    onClearSelection()
                  }
                }}
                aria-label="Select all"
                data-state={someSelected && !allSelected ? 'indeterminate' : undefined}
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead className="w-20 text-right">Qs</TableHead>
            <TableHead>Model</TableHead>
            <TableHead className="w-20 text-right">Temp</TableHead>
            <TableHead className="w-24 text-right">Sample</TableHead>
            <TableHead className="w-24">Algorithm</TableHead>
            <TableHead className="w-28">Created</TableHead>
            <TableHead className="w-32 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {surveys.map((survey) => {
            const run = latestRuns[survey.id]
            const runStatus = latestRunStatus[survey.id]
            // Single consolidated status: run status takes priority when active/in-progress
            const displayStatus: string =
              runStatus === 'running' || runStatus === 'pending'
                ? runStatus
                : survey.status === 'active' && runStatus === 'completed'
                ? 'finished'
                : survey.status

            const modelName = run ? getModelName(run.llm_config) : undefined
            const temperature = run?.llm_config?.temperature
            const sampleSize = run?.demographics
              ? isDemographicSelectionConfig(run.demographics)
                ? run.demographics.sample_size
                : undefined
              : undefined
            const algorithm = run?.algorithm

            return (
              <TableRow
                key={survey.id}
                data-state={selectedIds.has(survey.id) ? 'selected' : undefined}
              >
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(survey.id)}
                    onCheckedChange={() => onToggleSelect(survey.id)}
                    aria-label={`Select ${survey.name || 'survey'}`}
                  />
                </TableCell>
                <TableCell className="font-medium max-w-[200px]">
                  <Link
                    to={`/surveys/${survey.id}`}
                    className="hover:underline truncate block"
                    title={survey.name || 'Untitled Survey'}
                  >
                    {survey.name || 'Untitled Survey'}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      runStatusVariants[displayStatus] ??
                      surveyStatusVariants[displayStatus] ??
                      'outline'
                    }
                  >
                    {displayStatus}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {survey.questions.length}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs max-w-[160px]">
                  <span className="truncate block" title={modelName}>
                    {modelName ?? <span className="italic">—</span>}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground text-xs">
                  {temperature != null ? temperature : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground text-xs">
                  {sampleSize != null ? sampleSize : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {algorithm === 'anthology'
                    ? 'Anthology'
                    : algorithm === 'zero_shot_baseline'
                    ? 'Zero-Shot'
                    : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(survey.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Link to={`/surveys/${survey.id}`}>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="View survey">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                    {survey.status === 'active' && (
                      <Link to={`/surveys/${survey.id}/results`}>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="View results">
                          <BarChart3 className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      title="Duplicate survey"
                      onClick={() => onDuplicateSurvey(survey)}
                    >
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      title="Delete survey"
                      onClick={() => onDeleteSurvey(survey.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
