import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { createSurveyRun, createZeroShotBaselineRun } from '@/lib/surveyRunner'
import { validateRunConfig } from '@/lib/runValidation'
import { mergeEffectiveConfig } from '@/lib/llmConfig'
import { buildDemographicPromptText } from '@/lib/demographicPrompt'
import { isDemographicSelectionConfig } from '@/lib/backstoryFilters'
import type { Survey, LLMConfig } from '@/types/database'
import type { BatchConfig } from './BatchConfigDialog'
import { Play, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface BatchStartDialogProps {
  surveys: Survey[]
  selectedIds: Set<string>
  profileConfig?: LLMConfig
  maskedApiKeys: { openrouter: string | null; vllm: string | null }
  batchConfig: BatchConfig | null
  onComplete: () => void
}

interface SurveyValidation {
  survey: Survey
  valid: boolean | null
  error?: string
}

export function BatchStartDialog({
  surveys,
  selectedIds,
  profileConfig,
  maskedApiKeys,
  batchConfig,
  onComplete,
}: BatchStartDialogProps) {
  const [open, setOpen] = useState(false)
  const [validations, setValidations] = useState<SurveyValidation[]>([])
  const [validating, setValidating] = useState(false)
  const [starting, setStarting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const selectedSurveys = surveys.filter((s) => selectedIds.has(s.id))

  const runValidation = async () => {
    if (!batchConfig) return
    setValidating(true)
    setValidations(selectedSurveys.map((s) => ({ survey: s, valid: null })))

    const llmConfig = mergeEffectiveConfig(profileConfig, batchConfig.overrides)

    const results: SurveyValidation[] = await Promise.all(
      selectedSurveys.map(async (survey) => {
        const result = await validateRunConfig({
          survey,
          llmConfig,
          maskedApiKeys,
          demographics: batchConfig.demographics,
          algorithm: batchConfig.algorithm,
          adaptiveSampling: batchConfig.adaptiveSampling,
        })
        return { survey, valid: result.valid, error: result.error }
      })
    )

    setValidations(results)
    setValidating(false)
  }

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      setValidations([])
      setProgress(null)
      runValidation()
    }
  }

  const handleStartRuns = async () => {
    if (!batchConfig) return
    const valid = validations.filter((v) => v.valid)
    if (valid.length === 0) return

    setStarting(true)
    setProgress({ done: 0, total: valid.length })

    const llmConfig = {
      ...mergeEffectiveConfig(profileConfig, batchConfig.overrides),
      ...(batchConfig.adaptiveSampling.enabled
        ? { adaptive_sampling: batchConfig.adaptiveSampling }
        : {}),
    }

    let succeeded = 0
    let failed = 0

    for (const { survey } of valid) {
      const promptText =
        batchConfig.algorithm === 'zero_shot_baseline'
          ? buildDemographicPromptText(
              isDemographicSelectionConfig(batchConfig.demographics)
                ? batchConfig.demographics.filters
                : batchConfig.demographics
            )
          : undefined

      const fn =
        batchConfig.algorithm === 'zero_shot_baseline' ? createZeroShotBaselineRun : createSurveyRun
      const result = await fn({
        surveyId: survey.id,
        llmConfig,
        demographics: batchConfig.demographics,
        promptText,
      })

      if (result.success) {
        succeeded++
      } else {
        failed++
      }

      setProgress((p) => p && { ...p, done: p.done + 1 })
    }

    setStarting(false)
    setOpen(false)
    onComplete()

    toast({
      title:
        failed === 0
          ? `Started ${succeeded} run${succeeded !== 1 ? 's' : ''}`
          : `Started ${succeeded} run${succeeded !== 1 ? 's' : ''}, ${failed} failed`,
      variant: failed > 0 && succeeded === 0 ? 'destructive' : 'default',
    })
  }

  const validCount = validations.filter((v) => v.valid).length
  const invalidCount = validations.filter((v) => v.valid === false).length

  if (!batchConfig) {
    return (
      <Button size="sm" className="gap-2" disabled title="Configure runs first">
        <Play className="h-4 w-4" />
        Start Runs
      </Button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Play className="h-4 w-4" />
          Start Runs
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Start {selectedSurveys.length} Runs</DialogTitle>
          <DialogDescription>
            Validating configuration for each selected survey before starting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {validating && validations.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Validating...
            </div>
          )}

          {validations.map(({ survey, valid, error }) => (
            <div
              key={survey.id}
              className="flex items-start gap-3 rounded-lg border p-3 text-sm"
            >
              <div className="mt-0.5">
                {valid === null ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : valid ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-medium truncate block">{survey.name || 'Untitled Survey'}</span>
                {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
              </div>
            </div>
          ))}

          {!validating && validations.length > 0 && (
            <div className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
              {validCount > 0 && (
                <Badge variant="success">{validCount} ready</Badge>
              )}
              {invalidCount > 0 && (
                <Badge variant="destructive">{invalidCount} will be skipped</Badge>
              )}
            </div>
          )}

          {progress && (
            <div className="text-sm text-muted-foreground">
              Creating run {progress.done}/{progress.total}...
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={starting}>
            Cancel
          </Button>
          <Button
            onClick={handleStartRuns}
            disabled={validating || starting || validCount === 0}
          >
            {starting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              `Start ${validCount} Run${validCount !== 1 ? 's' : ''}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
