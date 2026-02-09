import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { Question, QuestionType } from '@/types/database'
import { Trash2, GripVertical, Plus, X } from 'lucide-react'

interface QuestionEditorProps {
  question: Question
  index: number
  onChange: (question: Question) => void
  onDelete: () => void
}

export function QuestionEditor({ question, index, onChange, onDelete }: QuestionEditorProps) {
  const [showOptions, setShowOptions] = useState(
    question.type === 'mcq' || question.type === 'multiple_select' || question.type === 'ranking'
  )

  const handleTypeChange = (type: QuestionType) => {
    const needsOptions = type === 'mcq' || type === 'multiple_select' || type === 'ranking'
    setShowOptions(needsOptions)
    onChange({
      ...question,
      type,
      options: needsOptions ? (question.options?.length ? question.options : ['', '']) : undefined,
    })
  }

  const handleOptionChange = (optionIndex: number, value: string) => {
    const newOptions = [...(question.options || [])]
    newOptions[optionIndex] = value
    onChange({ ...question, options: newOptions })
  }

  const addOption = () => {
    onChange({ ...question, options: [...(question.options || []), ''] })
  }

  const removeOption = (optionIndex: number) => {
    const newOptions = (question.options || []).filter((_, i) => i !== optionIndex)
    onChange({ ...question, options: newOptions })
  }

  return (
    <Card className="relative">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab" />
          <span className="font-semibold text-sm text-muted-foreground">Q{index + 1}</span>
          <Select value={question.type} onValueChange={handleTypeChange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mcq">Multiple Choice</SelectItem>
              <SelectItem value="multiple_select">Multi-Select</SelectItem>
              <SelectItem value="open_response">Open Response</SelectItem>
              <SelectItem value="ranking">Ranking</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`question-${question.qkey}`}>Question Text</Label>
          <Textarea
            id={`question-${question.qkey}`}
            value={question.text}
            onChange={(e) => onChange({ ...question, text: e.target.value })}
            placeholder="Enter your question..."
            rows={2}
          />
        </div>

        {showOptions && (
          <div className="space-y-2">
            <Label>Options</Label>
            <div className="space-y-2">
              {(question.options || []).map((option, optionIndex) => (
                <div key={optionIndex} className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground w-6">
                    {question.type === 'ranking' ? `${optionIndex + 1}.` : question.type === 'mcq' ? '○' : '☐'}
                  </span>
                  <Input
                    value={option}
                    onChange={(e) => handleOptionChange(optionIndex, e.target.value)}
                    placeholder={`Option ${optionIndex + 1}`}
                  />
                  {(question.options?.length || 0) > 2 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeOption(optionIndex)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={addOption}>
              <Plus className="h-4 w-4 mr-1" />
              Add Option
            </Button>
          </div>
        )}

        {question.type === 'open_response' && (
          <div className="border rounded-md p-3 bg-muted/50">
            <p className="text-sm text-muted-foreground italic">
              Respondents will provide a free-text answer to this question.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
