import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { Question, QuestionType, MediaAttachment } from '@/types/database'
import { MediaUpload } from '@/components/surveys/MediaUpload'
import { Trash2, GripVertical, Plus, X, Copy } from 'lucide-react'

interface QuestionEditorProps {
  question: Question
  index: number
  onChange: (question: Question) => void
  onDelete: () => void
  onDuplicate: () => void
}

export function QuestionEditor({ question, index, onChange, onDelete, onDuplicate }: QuestionEditorProps) {
  const [showOptions, setShowOptions] = useState(
    question.type === 'mcq' || question.type === 'multiple_select' || question.type === 'ranking'
  )

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.qkey })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

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
    const newOptionMedia = question.option_media ? [...question.option_media, null] : undefined
    onChange({ ...question, options: [...(question.options || []), ''], ...(newOptionMedia && { option_media: newOptionMedia }) })
  }

  const removeOption = (optionIndex: number) => {
    const newOptions = (question.options || []).filter((_, i) => i !== optionIndex)
    const newOptionMedia = question.option_media?.filter((_, i) => i !== optionIndex)
    onChange({ ...question, options: newOptions, option_media: newOptionMedia?.length ? newOptionMedia : undefined })
  }

  const handleQuestionMedia = (media: MediaAttachment | null) => {
    onChange({ ...question, media: media ?? undefined })
  }

  const handleOptionMedia = (optionIndex: number, media: MediaAttachment | null) => {
    const newOptionMedia = question.option_media
      ? [...question.option_media]
      : new Array(question.options?.length || 0).fill(null)
    newOptionMedia[optionIndex] = media
    // Clear option_media entirely if all null
    const hasAny = newOptionMedia.some((m) => m !== null)
    onChange({ ...question, option_media: hasAny ? newOptionMedia : undefined })
  }

  return (
    <Card ref={setNodeRef} style={style} className="relative">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="cursor-grab touch-none"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-5 w-5 text-muted-foreground" />
          </button>
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
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={onDuplicate} title="Duplicate question">
              <Copy className="h-4 w-4 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} title="Delete question">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
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
          <MediaUpload value={question.media} onChange={handleQuestionMedia} />
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
                  <MediaUpload
                    compact
                    value={question.option_media?.[optionIndex] ?? null}
                    onChange={(media) => handleOptionMedia(optionIndex, media)}
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
