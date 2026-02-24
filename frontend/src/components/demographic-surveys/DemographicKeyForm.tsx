import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import type { DistributionMode, Question } from '@/types/database'
import { X, Plus, ChevronDown } from 'lucide-react'

export interface DemographicKeyFormData {
  key: string
  displayName: string
  enumValues: string[]
  distributionMode: DistributionMode
  numTrials: number
  question: Question
}

interface DemographicKeyFormProps {
  value: DemographicKeyFormData
  onChange: (value: DemographicKeyFormData) => void
  existingKeys?: string[]
  errors?: Record<string, string>
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug ? `c_${slug}` : ''
}

function generateQuestion(displayName: string, enumValues: string[]): Question {
  return {
    qkey: 'demographic_q',
    type: 'mcq',
    text: `Which of the following best describes your ${displayName.toLowerCase()}?`,
    options: enumValues.length > 0 ? enumValues : undefined,
  }
}

const GHOST_EXAMPLES = ['e.g., Conservative', 'Moderate', 'Liberal']

export function DemographicKeyForm({ value, onChange, existingKeys = [], errors = {} }: DemographicKeyFormProps) {
  const [newEnumValue, setNewEnumValue] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const updateDisplayName = (name: string) => {
    const slug = slugify(name)
    const question = generateQuestion(name, value.enumValues)
    onChange({ ...value, displayName: name, key: slug, question })
  }

  const addEnumValue = () => {
    const trimmed = newEnumValue.trim()
    if (!trimmed || value.enumValues.includes(trimmed)) return
    const newValues = [...value.enumValues, trimmed]
    const question = generateQuestion(value.displayName, newValues)
    onChange({ ...value, enumValues: newValues, question })
    setNewEnumValue('')
  }

  const removeEnumValue = (val: string) => {
    const newValues = value.enumValues.filter((v) => v !== val)
    const question = generateQuestion(value.displayName, newValues)
    onChange({ ...value, enumValues: newValues, question })
  }

  const keyDuplicateError = value.key && existingKeys.includes(value.key) ? 'A demographic with this name already exists' : ''

  return (
    <Card>
      <CardHeader>
        <CardTitle>Define Demographic</CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        {/* Section 1: Name */}
        <div className="space-y-2">
          <Label htmlFor="display-name">Name</Label>
          <Input
            id="display-name"
            placeholder="e.g., Political Leaning"
            value={value.displayName}
            onChange={(e) => updateDisplayName(e.target.value)}
          />
          {value.key && (
            <p className={`text-xs ${keyDuplicateError ? 'text-destructive' : 'text-muted-foreground'}`}>
              {keyDuplicateError || `Key: ${value.key}`}
            </p>
          )}
        </div>

        {/* Divider */}
        <div className="border-t my-6" />

        {/* Section 2: Possible Values */}
        <div className="space-y-3">
          <div>
            <Label>Possible Values</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Add the categories the LLM can choose from. Type a value and press Enter.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {value.enumValues.length === 0 ? (
              // Ghost example chips
              GHOST_EXAMPLES.map((example) => (
                <Badge key={example} variant="outline" className="border-dashed text-muted-foreground">
                  {example}
                </Badge>
              ))
            ) : (
              // Real value chips
              value.enumValues.map((val) => (
                <Badge key={val} variant="secondary" className="gap-1 pr-1">
                  {val}
                  <button
                    type="button"
                    onClick={() => removeEnumValue(val)}
                    className="ml-0.5 rounded-full hover:bg-destructive/20 hover:text-destructive p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input
              placeholder="Type a value and press Enter..."
              value={newEnumValue}
              onChange={(e) => setNewEnumValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addEnumValue()
                }
              }}
            />
            <Button variant="outline" size="icon" onClick={addEnumValue} disabled={!newEnumValue.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {errors.enumValues && (
            <p className="text-xs text-destructive">{errors.enumValues}</p>
          )}
        </div>

        {/* Divider */}
        <div className="border-t my-6" />

        {/* Section 3: Survey Question */}
        <div className="space-y-3">
          <div>
            <Label>Survey Question</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Auto-generated from the name. This is what the LLM reads for each backstory.
            </p>
          </div>

          <Textarea
            value={value.question.text}
            onChange={(e) =>
              onChange({ ...value, question: { ...value.question, text: e.target.value } })
            }
            rows={2}
          />

          {value.question.options && value.question.options.length > 0 && (
            <div className="rounded-lg bg-muted/50 border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Options preview</p>
              <ul className="space-y-0.5">
                {value.question.options.map((opt, i) => (
                  <li key={i} className="text-sm text-muted-foreground">
                    ({String.fromCharCode(65 + i)}) {opt}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t my-6" />

        {/* Section 4: Advanced Settings (collapsible) */}
        <div>
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-0' : '-rotate-90'}`} />
            Advanced Settings
          </button>

          {advancedOpen && (
            <div className="mt-4 space-y-4 pl-6">
              <div className="space-y-2">
                <Label>Distribution Mode</Label>
                <Select
                  value={value.distributionMode}
                  onValueChange={(v) => onChange({ ...value, distributionMode: v as DistributionMode })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="n_sample">N-Sample (any provider)</SelectItem>
                    <SelectItem value="logprobs" disabled>
                      Logprobs (vLLM only — coming soon)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {value.distributionMode === 'n_sample' && (
                <div className="space-y-2">
                  <Label htmlFor="num-trials">Trials per Backstory</Label>
                  <Input
                    id="num-trials"
                    type="number"
                    min={1}
                    max={100}
                    value={value.numTrials}
                    onChange={(e) => onChange({ ...value, numTrials: Math.max(1, parseInt(e.target.value, 10) || 20) })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Each backstory answers the question N times independently. Default: 20.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
