import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Layout } from '@/components/layout/Layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { QuestionEditor } from '@/components/surveys/QuestionEditor'
import { DemographicFilter } from '@/components/surveys/DemographicFilter'
import { supabase } from '@/lib/supabase'
import { useAuthContext } from '@/contexts/AuthContext'
import type { Question, DemographicFilter as DemographicFilterType, Survey } from '@/types/database'
import { toast } from '@/hooks/use-toast'
import { Plus, Save, Play, ArrowLeft } from 'lucide-react'

export function SurveyCreate() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthContext()
  const isEditing = !!id

  const [name, setName] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [demographics, setDemographics] = useState<DemographicFilterType>({})
  const [includeOwnBackstories, setIncludeOwnBackstories] = useState(false)
  const [ownBackstoriesCount, setOwnBackstoriesCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isEditing) {
      loadSurvey()
    }
    fetchOwnBackstoriesCount()
  }, [id, user])

  const loadSurvey = async () => {
    if (!id) return
    const { data, error } = await supabase
      .from('surveys')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      console.error('Error loading survey:', error)
      navigate('/surveys')
    } else if (data) {
      const survey = data as Survey
      setName(survey.name || '')
      setQuestions(survey.questions)
      setDemographics(survey.demographics)
    }
  }

  const fetchOwnBackstoriesCount = async () => {
    if (!user) return

    const { count } = await supabase
      .from('backstories')
      .select('id', { count: 'exact', head: true })
      .eq('contributor_id', user.id)

    setOwnBackstoriesCount(count || 0)
  }

  const addQuestion = () => {
    const newQuestion: Question = {
      qkey: `q${questions.length + 1}`,
      type: 'mcq',
      text: '',
      options: ['', ''],
    }
    setQuestions([...questions, newQuestion])
  }

  const updateQuestion = (index: number, question: Question) => {
    const newQuestions = [...questions]
    newQuestions[index] = question
    setQuestions(newQuestions)
  }

  const deleteQuestion = (index: number) => {
    setQuestions(questions.filter((_, i) => i !== index))
  }

  const duplicateQuestion = (index: number) => {
    const questionToDuplicate = questions[index]
    const newQuestion: Question = {
      ...questionToDuplicate,
      qkey: `q${Date.now()}`, // Unique key for the duplicated question
      options: questionToDuplicate.options ? [...questionToDuplicate.options] : undefined,
    }
    const newQuestions = [...questions]
    newQuestions.splice(index + 1, 0, newQuestion)
    setQuestions(newQuestions)
    toast({ title: 'Copied!' })
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setQuestions((items) => {
        const oldIndex = items.findIndex((item) => item.qkey === active.id)
        const newIndex = items.findIndex((item) => item.qkey === over.id)
        return arrayMove(items, oldIndex, newIndex)
      })
    }
  }

  const validateSurvey = (): string | null => {
    if (!name.trim()) {
      return 'Please enter a survey name'
    }
    if (questions.length === 0) {
      return 'Please add at least one question'
    }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      if (!q.text.trim()) {
        return `Question ${i + 1} is missing text`
      }
      if (q.type !== 'open_response' && (!q.options || q.options.length < 2)) {
        return `Question ${i + 1} needs at least 2 options`
      }
      if (q.options?.some((opt) => !opt.trim())) {
        return `Question ${i + 1} has empty options`
      }
    }
    return null
  }

  const saveSurvey = async (status: 'draft' | 'queued' = 'draft') => {
    if (!user) return

    const validationError = validateSurvey()
    if (validationError) {
      setError(validationError)
      return null
    }

    setError(null)
    setSaving(true)

    const surveyData = {
      user_id: user.id,
      name: name.trim(),
      questions: questions as unknown,
      demographics: demographics as unknown,
      status,
    } as Record<string, unknown>

    let result: Survey | null = null

    if (isEditing && id) {
      const { data, error } = await supabase
        .from('surveys')
        .update(surveyData)
        .eq('id', id)
        .select()
        .single()

      if (error) {
        console.error('Error updating survey:', error)
        setError('Failed to save survey')
      } else {
        result = data as Survey
      }
    } else {
      const { data, error } = await supabase
        .from('surveys')
        .insert(surveyData)
        .select()
        .single()

      if (error) {
        console.error('Error creating survey:', error)
        setError('Failed to create survey')
      } else {
        result = data as Survey
      }
    }

    setSaving(false)
    return result
  }

  const handleSaveDraft = async () => {
    const result = await saveSurvey('draft')
    if (result) {
      navigate(`/surveys/${result.id}`)
    }
  }

  const handleRunSurvey = async () => {
    setRunning(true)
    const result = await saveSurvey('queued')
    if (result) {
      // In a real implementation, this would also trigger the worker
      navigate(`/surveys/${result.id}`)
    }
    setRunning(false)
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/surveys')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">
              {isEditing ? 'Edit Survey' : 'Create Survey'}
            </h1>
            <p className="text-muted-foreground">
              {isEditing ? 'Update your survey questions and settings' : 'Design your survey questions'}
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 text-sm text-red-500 bg-red-50 border border-red-200 rounded-md">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Survey Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="name">Survey Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Political Attitudes Survey"
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Questions</h2>
            <Button onClick={addQuestion}>
              <Plus className="h-4 w-4 mr-2" />
              Add Question
            </Button>
          </div>

          {questions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <p className="text-muted-foreground mb-4">No questions yet. Add your first question!</p>
                <Button onClick={addQuestion}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Question
                </Button>
              </CardContent>
            </Card>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={questions.map((q) => q.qkey)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-4">
                  {questions.map((question, index) => (
                    <QuestionEditor
                      key={question.qkey}
                      question={question}
                      index={index}
                      onChange={(q) => updateQuestion(index, q)}
                      onDelete={() => deleteQuestion(index)}
                      onDuplicate={() => duplicateQuestion(index)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <DemographicFilter value={demographics} onChange={setDemographics} />

        {ownBackstoriesCount > 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-own"
                  checked={includeOwnBackstories}
                  onCheckedChange={(checked) => setIncludeOwnBackstories(checked as boolean)}
                />
                <label htmlFor="include-own" className="text-sm">
                  Also include my own backstories ({ownBackstoriesCount} available)
                </label>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-end gap-4 pb-8">
          <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Draft'}
          </Button>
          <Button onClick={handleRunSurvey} disabled={running || saving}>
            <Play className="h-4 w-4 mr-2" />
            {running ? 'Starting...' : 'Run Survey'}
          </Button>
        </div>
      </div>
    </Layout>
  )
}
