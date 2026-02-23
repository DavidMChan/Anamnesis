import { useState, useEffect, useRef } from 'react'
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
import { deleteMedia, copyMedia } from '@/lib/media'
import type { MediaAttachment } from '@/types/database'
import { Plus, Save, ArrowLeft } from 'lucide-react'

/** Collect all Wasabi media keys referenced by a list of questions. */
function collectMediaKeys(qs: Question[]): Set<string> {
  const keys = new Set<string>()
  for (const q of qs) {
    if (q.media?.key) keys.add(q.media.key)
    q.option_media?.forEach((m) => { if (m?.key) keys.add(m.key) })
  }
  return keys
}

export function SurveyCreate() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthContext()
  const isEditing = !!id

  const [name, setName] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [demographics, setDemographics] = useState<DemographicFilterType>({})
  const [sampleSize, setSampleSize] = useState<number | undefined>(undefined)
  const [includeOwnBackstories, setIncludeOwnBackstories] = useState(false)
  const [ownBackstoriesCount, setOwnBackstoriesCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Baseline snapshot of questions as last persisted in DB — used to diff orphaned media on save
  const savedQuestionsRef = useRef<Question[]>([])

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
      // Active surveys can't be edited — redirect to view page
      if (survey.status === 'active') {
        navigate(`/surveys/${id}`, { replace: true })
        return
      }
      setName(survey.name || '')
      setQuestions(survey.questions)
      savedQuestionsRef.current = survey.questions
      // Extract sample size from demographics if present
      const { _sample_size, ...restDemographics } = survey.demographics as DemographicFilterType & { _sample_size?: number[] }
      setDemographics(restDemographics)
      setSampleSize(_sample_size?.[0])
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

  const duplicateQuestion = async (index: number) => {
    const src = questions[index]
    const hasMedia = !!(src.media || src.option_media?.some((m) => m != null))

    let copiedMedia: MediaAttachment | undefined
    let copiedOptionMedia: (MediaAttachment | null)[] | undefined
    let copyFailed = false

    if (hasMedia) {
      setDuplicating(true)
      try {
        copiedMedia = src.media ? await copyMedia(src.media) : undefined
        copiedOptionMedia = src.option_media
          ? await Promise.all(src.option_media.map((m) => (m ? copyMedia(m) : null)))
          : undefined
      } catch {
        copyFailed = true
      }
      setDuplicating(false)
    }

    const newQuestion: Question = {
      ...src,
      qkey: `q${Date.now()}`,
      options: src.options ? [...src.options] : undefined,
      media: copiedMedia,
      option_media: copiedOptionMedia?.length ? copiedOptionMedia : undefined,
    }
    const newQuestions = [...questions]
    newQuestions.splice(index + 1, 0, newQuestion)
    setQuestions(newQuestions)
    toast({ title: copyFailed ? 'Copied (without media — copy failed)' : 'Copied!' })
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
      if (!q.text.trim() && !q.media) {
        return `Question ${i + 1} needs text or media`
      }
      if (q.type !== 'open_response' && (!q.options || q.options.length < 2)) {
        return `Question ${i + 1} needs at least 2 options`
      }
      if (q.options?.some((opt, j) => !opt.trim() && !q.option_media?.[j])) {
        return `Question ${i + 1} has empty options (add text or media)`
      }
    }
    return null
  }

  const saveSurvey = async (status: 'draft' | 'active' = 'draft') => {
    if (!user) return

    const validationError = validateSurvey()
    if (validationError) {
      setError(validationError)
      return null
    }

    setError(null)
    setSaving(true)

    // Combine demographics with sample size (if set)
    const demographicsWithSampleSize = sampleSize
      ? { ...demographics, _sample_size: [sampleSize] }
      : demographics

    const surveyData = {
      user_id: user.id,
      name: name.trim(),
      questions: questions as unknown,
      demographics: demographicsWithSampleSize as unknown,
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

    // After successful DB save, clean up orphaned Wasabi media
    if (result) {
      const prevKeys = collectMediaKeys(savedQuestionsRef.current)
      const currKeys = collectMediaKeys(questions)
      for (const key of prevKeys) {
        if (!currKeys.has(key)) deleteMedia(key)
      }
      savedQuestionsRef.current = questions
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
                      onDuplicate={() => !duplicating && duplicateQuestion(index)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <DemographicFilter
          value={demographics}
          onChange={setDemographics}
          sampleSize={sampleSize}
          onSampleSizeChange={setSampleSize}
        />

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
          <Button onClick={handleSaveDraft} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Layout>
  )
}
