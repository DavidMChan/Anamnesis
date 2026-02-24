import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { DemographicValueType, DistributionMode, Question } from '@/types/database'
import { X, Plus } from 'lucide-react'

export interface DemographicKeyFormData {
  key: string
  displayName: string
  valueType: DemographicValueType
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
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function generateQuestion(displayName: string, valueType: DemographicValueType, enumValues: string[]): Question {
  if (valueType === 'enum' && enumValues.length > 0) {
    return {
      qkey: 'demographic_q',
      type: 'mcq',
      text: `Based on this person's backstory, what is their ${displayName}?`,
      options: enumValues,
    }
  }
  return {
    qkey: 'demographic_q',
    type: 'open_response',
    text: `Based on this person's backstory, what is their ${displayName}? Respond with only the value.`,
  }
}

export function DemographicKeyForm({ value, onChange, existingKeys = [], errors = {} }: DemographicKeyFormProps) {
  const [newEnumValue, setNewEnumValue] = useState('')

  // Auto-generate key slug from display name
  const updateDisplayName = (name: string) => {
    const slug = slugify(name)
    const question = generateQuestion(name, value.valueType, value.enumValues)
    onChange({ ...value, displayName: name, key: slug, question })
  }

  // Auto-generate question when value type or enum values change
  const updateValueType = (vt: DemographicValueType) => {
    const question = generateQuestion(value.displayName, vt, value.enumValues)
    onChange({ ...value, valueType: vt, question })
  }

  const addEnumValue = () => {
    const trimmed = newEnumValue.trim()
    if (!trimmed || value.enumValues.includes(trimmed)) return
    const newValues = [...value.enumValues, trimmed]
    const question = generateQuestion(value.displayName, value.valueType, newValues)
    onChange({ ...value, enumValues: newValues, question })
    setNewEnumValue('')
  }

  const removeEnumValue = (val: string) => {
    const newValues = value.enumValues.filter((v) => v !== val)
    const question = generateQuestion(value.displayName, value.valueType, newValues)
    onChange({ ...value, enumValues: newValues, question })
  }

  const keyError = errors.key || (value.key && existingKeys.includes(value.key) ? 'This key already exists' : '')
  const keyFormatError = value.key && /[^a-z0-9_]/.test(value.key) ? 'Only lowercase letters, numbers, and underscores' : ''

  return (
    <div className="space-y-6">
      {/* Key Definition */}
      <Card>
        <CardHeader>
          <CardTitle>Demographic Key</CardTitle>
          <CardDescription>
            Define a new demographic dimension that will be determined for all backstories.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="display-name">Display Name</Label>
            <Input
              id="display-name"
              placeholder="e.g., Political Leaning"
              value={value.displayName}
              onChange={(e) => updateDisplayName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="key-slug">Key (slug)</Label>
            <Input
              id="key-slug"
              placeholder="e.g., political_leaning"
              value={value.key}
              onChange={(e) => {
                const question = generateQuestion(value.displayName, value.valueType, value.enumValues)
                onChange({ ...value, key: e.target.value, question })
              }}
              className={keyError || keyFormatError ? 'border-destructive' : ''}
            />
            {(keyError || keyFormatError) && (
              <p className="text-xs text-destructive">{keyError || keyFormatError}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Used as the key in backstory demographics. No spaces, lowercase only.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Value Type</Label>
            <Select value={value.valueType} onValueChange={(v) => updateValueType(v as DemographicValueType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enum">Enum (fixed choices)</SelectItem>
                <SelectItem value="numeric">Numeric</SelectItem>
                <SelectItem value="text">Text</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Enum Values */}
          {value.valueType === 'enum' && (
            <div className="space-y-2">
              <Label>Enum Values</Label>
              <div className="flex flex-wrap gap-2 mb-2">
                {value.enumValues.map((val) => (
                  <div
                    key={val}
                    className="flex items-center gap-1 bg-secondary text-secondary-foreground rounded-md px-2 py-1 text-sm"
                  >
                    <span>{val}</span>
                    <button
                      type="button"
                      onClick={() => removeEnumValue(val)}
                      className="hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Add value..."
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
          )}
        </CardContent>
      </Card>

      {/* Distribution Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Distribution Mode</CardTitle>
          <CardDescription>
            How to compute the probability distribution for each backstory.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Mode</Label>
            <Select
              value={value.distributionMode}
              onValueChange={(v) => onChange({ ...value, distributionMode: v as DistributionMode })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="n_sample">N-Sample (any provider)</SelectItem>
                <SelectItem value="logprobs" disabled title="Coming soon — requires vLLM with logprobs API support">
                  Logprobs (vLLM only — coming soon)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {value.distributionMode === 'n_sample' && (
            <div className="space-y-2">
              <Label htmlFor="num-trials">Number of Trials (N)</Label>
              <Input
                id="num-trials"
                type="number"
                min={1}
                max={100}
                value={value.numTrials}
                onChange={(e) => onChange({ ...value, numTrials: Math.max(1, parseInt(e.target.value, 10) || 20) })}
              />
              <p className="text-xs text-muted-foreground">
                Each backstory will answer the question N times independently. Default: 20.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Question Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Question</CardTitle>
          <CardDescription>
            Auto-generated from the key definition. You can edit it below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Question Text</Label>
            <Textarea
              value={value.question.text}
              onChange={(e) =>
                onChange({ ...value, question: { ...value.question, text: e.target.value } })
              }
              rows={3}
            />
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-medium">Type:</span>{' '}
            {value.question.type === 'mcq' ? 'Multiple Choice' : 'Open Response'}
          </div>
          {value.question.options && value.question.options.length > 0 && (
            <div className="text-sm">
              <span className="font-medium text-muted-foreground">Options:</span>
              <ul className="mt-1 ml-4 space-y-0.5">
                {value.question.options.map((opt, i) => (
                  <li key={i} className="text-muted-foreground">
                    ({String.fromCharCode(65 + i)}) {opt}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
