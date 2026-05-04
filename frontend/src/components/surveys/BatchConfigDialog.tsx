import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { RunConfigCard } from '@/components/surveys/RunConfigCard'
import { DemographicFilter, defaultDemographicSelectionConfig } from '@/components/surveys/DemographicFilter'
import type { LLMConfig, DemographicSelectionConfig, SurveyAlgorithm, AdaptiveSamplingConfig } from '@/types/database'
import { Settings, AlertTriangle } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const DEFAULT_ADAPTIVE_SAMPLING: AdaptiveSamplingConfig = {
  enabled: false,
  epsilon: 0.01,
  min_samples: 30,
}

export interface BatchConfig {
  overrides: Partial<LLMConfig>
  demographics: DemographicSelectionConfig
  algorithm: SurveyAlgorithm
  adaptiveSampling: AdaptiveSamplingConfig
}

interface BatchConfigDialogProps {
  profileConfig?: LLMConfig
  selectedCount: number
  onApply: (config: BatchConfig) => void
}

export function BatchConfigDialog({ profileConfig, selectedCount, onApply }: BatchConfigDialogProps) {
  const [open, setOpen] = useState(false)
  const [overrides, setOverrides] = useState<Partial<LLMConfig>>({})
  const [demographics, setDemographics] = useState<DemographicSelectionConfig>(
    defaultDemographicSelectionConfig()
  )
  const [algorithm, setAlgorithm] = useState<SurveyAlgorithm>('anthology')
  const [adaptiveSampling, setAdaptiveSampling] = useState<AdaptiveSamplingConfig>(DEFAULT_ADAPTIVE_SAMPLING)

  const handleApply = () => {
    onApply({ overrides, demographics, algorithm, adaptiveSampling })
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Settings className="h-4 w-4" />
          Configure
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Batch Configure {selectedCount} Surveys</DialogTitle>
          <DialogDescription>
            Set the run configuration that will be applied to all selected surveys when you start runs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Algorithm */}
          <div className="space-y-2">
            <Label className="text-base font-semibold">Algorithm</Label>
            <Select value={algorithm} onValueChange={(v) => setAlgorithm(v as SurveyAlgorithm)}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthology">Anthology (backstory-conditioned)</SelectItem>
                <SelectItem value="zero_shot_baseline">Zero-Shot Baseline</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* LLM Config */}
          <RunConfigCard
            profileConfig={profileConfig}
            overrides={overrides}
            onChangeOverrides={setOverrides}
          />

          {/* Demographics */}
          <DemographicFilter
            value={demographics}
            onChange={setDemographics}
            description="Choose the target population for all selected surveys."
            sampleSizeLabel={
              adaptiveSampling.enabled
                ? 'Maximum samples'
                : algorithm === 'zero_shot_baseline'
                ? 'Number of trials'
                : undefined
            }
          />

          {/* Early Stopping */}
          <Card>
            <CardHeader>
              <CardTitle>Early Stopping</CardTitle>
              <CardDescription>
                Beta posterior on MCQ counts. Stops when P(ranking is wrong) &lt; ε.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={adaptiveSampling.enabled}
                  onCheckedChange={(checked) =>
                    setAdaptiveSampling((cur) => ({ ...cur, enabled: checked === true }))
                  }
                  className="mt-0.5"
                />
                <div className="space-y-1">
                  <span className="text-sm font-medium">Run until stable</span>
                  <p className="text-sm text-muted-foreground">Sample size above acts as a cap.</p>
                </div>
              </label>

              {adaptiveSampling.enabled && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Epsilon</Label>
                    <Input
                      type="number"
                      min={0.0001}
                      max={0.5}
                      step={0.001}
                      value={adaptiveSampling.epsilon}
                      onChange={(e) => {
                        const value = Number(e.target.value)
                        if (Number.isFinite(value))
                          setAdaptiveSampling((cur) => ({ ...cur, epsilon: value }))
                      }}
                    />
                    <p className="text-xs text-muted-foreground">0.01 ⇒ ≥ 99% confidence.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Minimum samples</Label>
                    <Input
                      type="number"
                      min={2}
                      step={1}
                      value={adaptiveSampling.min_samples}
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10)
                        if (Number.isFinite(value))
                          setAdaptiveSampling((cur) => ({ ...cur, min_samples: Math.max(2, value) }))
                      }}
                    />
                    <p className="text-xs text-muted-foreground">Floor before stability is checked.</p>
                  </div>
                </div>
              )}

              {adaptiveSampling.enabled && demographics.mode === 'balanced' && (
                <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Balanced Matching creates a balanced candidate set, but early stopping can finish before all allocated slots complete.</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply}>Apply to {selectedCount} surveys</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
