import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BatchConfigDialog, type BatchConfig } from './BatchConfigDialog'
import { BatchStartDialog } from './BatchStartDialog'
import { generateSurveyCSV } from '@/lib/csvExport'
import type { Survey, LLMConfig } from '@/types/database'
import { supabase } from '@/lib/supabase'
import { Download, X, CheckCircle2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface BatchActionToolbarProps {
  surveys: Survey[]
  selectedIds: Set<string>
  profileConfig?: LLMConfig
  maskedApiKeys: { openrouter: string | null; vllm: string | null }
  onClearSelection: () => void
  onRunsStarted: () => void
}

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

  const selectedCount = selectedIds.size

  const handleApplyConfig = (config: BatchConfig) => {
    setBatchConfig(config)
    setConfigApplied(true)
  }

  const handleDownloadCSVs = async () => {
    if (downloading) return
    setDownloading(true)

    const selectedSurveys = surveys.filter((s) => selectedIds.has(s.id))

    // Fetch ALL completed runs for each selected survey (not just latest)
    const { data: allRuns } = await supabase
      .from('survey_runs')
      .select('*')
      .in('survey_id', selectedSurveys.map((s) => s.id))
      .eq('status', 'completed')
      .order('created_at', { ascending: false })

    if (!allRuns || allRuns.length === 0) {
      toast({
        title: 'No completed runs',
        description: 'None of the selected surveys have completed runs with results.',
        variant: 'destructive',
      })
      setDownloading(false)
      return
    }

    // Group runs by survey_id so we can number them per survey
    const runsBySurvey = new Map<string, typeof allRuns>()
    for (const run of allRuns) {
      const existing = runsBySurvey.get(run.survey_id) ?? []
      existing.push(run)
      runsBySurvey.set(run.survey_id, existing)
    }

    const surveysSkipped = selectedSurveys.filter((s) => !runsBySurvey.has(s.id)).length

    let downloaded = 0
    const totalToDownload = allRuns.length

    for (const survey of selectedSurveys) {
      const runs = runsBySurvey.get(survey.id)
      if (!runs) continue

      for (let i = 0; i < runs.length; i++) {
        const run = runs[i] as import('@/types/database').SurveyRun
        // generateSurveyCSV fetches results from survey_tasks internally
        try {
          const { blob, filename } = await generateSurveyCSV(survey, run)
          // Add run index suffix when multiple runs exist for the same survey
          const nameWithSuffix =
            runs.length > 1
              ? filename.replace(/\.csv$/, `_run${runs.length - i}.csv`)
              : filename
          const link = document.createElement('a')
          link.href = URL.createObjectURL(blob)
          link.download = nameWithSuffix
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          downloaded++
        } catch (err) {
          console.error('CSV generation failed for', survey.name, err)
        }

        if (downloaded < totalToDownload) {
          await new Promise((r) => setTimeout(r, 150))
        }
      }
    }

    setDownloading(false)

    toast({
      title: `Downloaded ${downloaded} CSV${downloaded !== 1 ? 's' : ''}${surveysSkipped > 0 ? ` (${surveysSkipped} survey${surveysSkipped !== 1 ? 's' : ''} skipped — no completed runs)` : ''}`,
    })
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

        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={handleDownloadCSVs}
          disabled={downloading}
        >
          <Download className="h-4 w-4" />
          {downloading ? 'Downloading...' : 'Download CSVs'}
        </Button>

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
    </div>
  )
}
