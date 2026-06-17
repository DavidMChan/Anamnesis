import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BatchConfigDialog, type BatchConfig } from './BatchConfigDialog'
import { BatchStartDialog } from './BatchStartDialog'
import { DownloadRunsDialog, type RunPick } from './DownloadRunsDialog'
import { generateSurveyCSV } from '@/lib/csvExport'
import type { Survey, SurveyRun, LLMConfig } from '@/types/database'
import { supabase } from '@/lib/supabase'
import { Download, X, CheckCircle2, ChevronDown } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface BatchActionToolbarProps {
  surveys: Survey[]
  selectedIds: Set<string>
  profileConfig?: LLMConfig
  maskedApiKeys: { openrouter: string | null; vllm: string | null }
  onClearSelection: () => void
  onRunsStarted: () => void
}

type DownloadScope = 'latest' | 'all'

export function BatchActionToolbar({
  surveys,
  selectedIds,
  profileConfig,
  maskedApiKeys,
  onClearSelection,
  onRunsStarted,
}: BatchActionToolbarProps) {
  const [batchConfig, setBatchConfig] = useState<BatchConfig | null>(null)
  const [configApplied, setConfigApplied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const selectedCount = selectedIds.size

  const handleApplyConfig = (config: BatchConfig) => {
    setBatchConfig(config)
    setConfigApplied(true)
  }

  const handleDownloadScope = async (scope: DownloadScope) => {
    if (downloading) return
    setDownloading(true)

    const selectedSurveys = surveys.filter((s) => selectedIds.has(s.id))
    const { data: allRuns } = await supabase
      .from('survey_runs')
      .select('*')
      .in('survey_id', selectedSurveys.map((s) => s.id))
      .eq('status', 'completed')
      .order('created_at', { ascending: false })

    const completedRuns = (allRuns ?? []) as SurveyRun[]

    if (completedRuns.length === 0) {
      toast({
        title: 'No completed runs',
        description: 'None of the selected surveys have completed runs with results.',
        variant: 'destructive',
      })
      setDownloading(false)
      return
    }

    const surveysById = new Map(selectedSurveys.map((s) => [s.id, s]))
    const seenSurveyIds = new Set<string>()
    const picks: RunPick[] = []
    for (const run of completedRuns) {
      const survey = surveysById.get(run.survey_id)
      if (!survey) continue
      if (scope === 'latest') {
        if (seenSurveyIds.has(run.survey_id)) continue
        seenSurveyIds.add(run.survey_id)
      }
      picks.push({ survey, run })
    }

    await downloadPicks(picks)
    setDownloading(false)
  }

  const downloadPicks = async (picks: RunPick[]) => {
    if (picks.length === 0) return

    // Number picks within each survey by created_at ascending: oldest = run1.
    const suffixById = new Map<string, string>()
    const grouped = new Map<string, RunPick[]>()
    for (const p of picks) {
      const list = grouped.get(p.survey.id) ?? []
      list.push(p)
      grouped.set(p.survey.id, list)
    }
    for (const list of grouped.values()) {
      if (list.length <= 1) continue
      const sorted = [...list].sort(
        (a, b) => new Date(a.run.created_at).getTime() - new Date(b.run.created_at).getTime(),
      )
      sorted.forEach((p, idx) => suffixById.set(p.run.id, `_run${idx + 1}`))
    }

    let downloaded = 0
    for (let i = 0; i < picks.length; i++) {
      const { survey, run } = picks[i]
      try {
        const { blob, filename } = await generateSurveyCSV(survey, run)
        const suffix = suffixById.get(run.id)
        const outName = suffix ? filename.replace(/\.csv$/, `${suffix}.csv`) : filename
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = outName
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        downloaded++
      } catch (err) {
        console.error('CSV generation failed for', survey.name, err)
      }
      if (i < picks.length - 1) {
        await new Promise((r) => setTimeout(r, 150))
      }
    }

    toast({
      title: `Downloaded ${downloaded} CSV${downloaded !== 1 ? 's' : ''}`,
    })
  }

  const handlePickerConfirm = async (picks: RunPick[]) => {
    if (downloading) return
    setDownloading(true)
    await downloadPicks(picks)
    setDownloading(false)
  }

  if (selectedCount === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background/95 backdrop-blur shadow-lg px-4 py-3">
        <span className="text-sm font-medium mr-2 text-muted-foreground">
          {selectedCount} selected
        </span>

        {configApplied && (
          <span className="flex items-center gap-1 text-xs text-green-600 mr-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Config set
          </span>
        )}

        <BatchConfigDialog
          profileConfig={profileConfig}
          selectedCount={selectedCount}
          onApply={handleApplyConfig}
        />

        <BatchStartDialog
          surveys={surveys}
          selectedIds={selectedIds}
          profileConfig={profileConfig}
          maskedApiKeys={maskedApiKeys}
          batchConfig={batchConfig}
          onComplete={() => {
            onRunsStarted()
            onClearSelection()
          }}
        />

        <div className="inline-flex">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 rounded-r-none border-r-0"
            onClick={() => handleDownloadScope('latest')}
            disabled={downloading}
          >
            <Download className="h-4 w-4" />
            {downloading ? 'Downloading…' : 'Download latest'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="rounded-l-none px-2"
                disabled={downloading}
                aria-label="Download options"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => handleDownloadScope('latest')}>
                Latest run per survey
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleDownloadScope('all')}>
                All completed runs
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setPickerOpen(true)}>
                Pick specific runs…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground"
          onClick={onClearSelection}
        >
          <X className="h-4 w-4" />
          Clear
        </Button>
      </div>

      <DownloadRunsDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        surveys={surveys}
        selectedSurveyIds={selectedIds}
        onConfirm={handlePickerConfirm}
      />
    </div>
  )
}
