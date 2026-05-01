import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { BatchConfigDialog, type BatchConfig } from './BatchConfigDialog'
import { BatchStartDialog } from './BatchStartDialog'
import { generateSurveyCSV } from '@/lib/csvExport'
import type { Survey, SurveyRun, LLMConfig } from '@/types/database'
import { supabase } from '@/lib/supabase'
import { Download, X, CheckCircle2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface BatchActionToolbarProps {
  surveys: Survey[]
  selectedIds: Set<string>
  latestRuns: Record<string, SurveyRun>
  profileConfig?: LLMConfig
  maskedApiKeys: { openrouter: string | null; vllm: string | null }
  onClearSelection: () => void
  onRunsStarted: () => void
}

export function BatchActionToolbar({
  surveys,
  selectedIds,
  latestRuns,
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
    const surveysWithRuns = selectedSurveys.filter((s) => {
      const run = latestRuns[s.id]
      return run?.status === 'completed' && run.results
    })

    if (surveysWithRuns.length === 0) {
      toast({
        title: 'No completed runs',
        description: 'None of the selected surveys have completed runs with results.',
        variant: 'destructive',
      })
      setDownloading(false)
      return
    }

    const skipped = selectedSurveys.length - surveysWithRuns.length

    // Fetch full results if not already in the run object
    let downloaded = 0
    for (const survey of surveysWithRuns) {
      const run = latestRuns[survey.id]
      let results = run.results

      // If results not loaded in the run object, fetch the latest completed run with results
      if (!results) {
        const { data } = await supabase
          .from('survey_runs')
          .select('*')
          .eq('survey_id', survey.id)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (data?.results) {
          results = data.results
        }
      }

      if (!results) continue

      try {
        const { blob, filename } = await generateSurveyCSV(survey, run, results)
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        downloaded++
      } catch (err) {
        console.error('CSV generation failed for', survey.name, err)
      }

      // Stagger downloads to avoid browser blocking
      if (downloaded < surveysWithRuns.length) {
        await new Promise((r) => setTimeout(r, 150))
      }
    }

    setDownloading(false)

    toast({
      title: `Downloaded ${downloaded} CSV${downloaded !== 1 ? 's' : ''}${skipped > 0 ? ` (${skipped} skipped — no completed runs)` : ''}`,
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
