import { useState, useEffect } from 'react'
import Papa from 'papaparse'
import { Upload, Download } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { supabase } from '@/lib/supabase'
import { uploadMedia } from '@/lib/media'
import { useAuthContext } from '@/contexts/AuthContext'
import { toast } from '@/hooks/use-toast'
import type { Question, QuestionType, DemographicFilter, MediaAttachment, DemographicKey } from '@/types/database'

interface BatchUploadDialogProps {
  onSurveysCreated: () => void
}

interface ParsedRow {
  index: number
  name: string
  questions: Question[] | null
  demographics: DemographicFilter
  error: string | null
  warnings: string[]
}

// Question as it exists during parse (before media resolution)
type RawQuestion = Question & {
  media_file?: string
  option_media_files?: (string | null)[]
}

const VALID_QUESTION_TYPES: QuestionType[] = ['mcq', 'multiple_select', 'open_response', 'ranking']

function validateAndParseQuestions(
  rawQuestions: unknown[],
  mediaFiles: File[]
): { questions: RawQuestion[] | null; error: string | null; warnings: string[] } {
  const warnings: string[] = []

  if (!Array.isArray(rawQuestions)) {
    return { questions: null, error: '"questions" must be a JSON array', warnings }
  }

  const questions: RawQuestion[] = []

  for (let i = 0; i < rawQuestions.length; i++) {
    const q = rawQuestions[i] as Record<string, unknown>
    const qkey = `q${i + 1}`
    const type = q.type as string

    if (!VALID_QUESTION_TYPES.includes(type as QuestionType)) {
      return {
        questions: null,
        error: `Question ${i + 1}: invalid type "${type}". Must be one of: ${VALID_QUESTION_TYPES.join(', ')}`,
        warnings,
      }
    }

    const hasMediaFile = typeof q.media_file === 'string' && (q.media_file as string).length > 0
    const text = typeof q.text === 'string' ? q.text : ''

    if (!text && !hasMediaFile) {
      return {
        questions: null,
        error: `Question ${i + 1}: "text" is required unless "media_file" is provided`,
        warnings,
      }
    }

    const needsOptions = type !== 'open_response'
    if (needsOptions) {
      if (!Array.isArray(q.options) || (q.options as unknown[]).length < 2) {
        return {
          questions: null,
          error: `Question ${i + 1}: "options" required with at least 2 items for type "${type}"`,
          warnings,
        }
      }
    }

    const options = Array.isArray(q.options) ? (q.options as string[]) : undefined

    let optionMediaFiles: (string | null)[] | undefined
    if (q.option_media_files !== undefined) {
      if (!Array.isArray(q.option_media_files)) {
        return {
          questions: null,
          error: `Question ${i + 1}: "option_media_files" must be an array`,
          warnings,
        }
      }
      if (options && (q.option_media_files as unknown[]).length !== options.length) {
        return {
          questions: null,
          error: `Question ${i + 1}: "option_media_files" length must match "options" length`,
          warnings,
        }
      }
      optionMediaFiles = q.option_media_files as (string | null)[]
    }

    // Validate each option has text or matching option_media_files entry
    if (options) {
      for (let j = 0; j < options.length; j++) {
        const optText = options[j]
        const hasOptMedia = optionMediaFiles != null && optionMediaFiles[j] != null
        if (!optText && !hasOptMedia) {
          return {
            questions: null,
            error: `Question ${i + 1}, option ${j + 1}: must have text or a corresponding media file`,
            warnings,
          }
        }
      }
    }

    // Check media file matching (warnings only, non-blocking)
    if (hasMediaFile) {
      const mediaFile = q.media_file as string
      const matched = mediaFiles.find((f) => f.name === mediaFile)
      if (!matched) {
        warnings.push(`"${mediaFile}" not found — question ${i + 1} will be imported without media`)
      }
    }

    if (optionMediaFiles) {
      for (const filename of optionMediaFiles) {
        if (filename != null) {
          const matched = mediaFiles.find((f) => f.name === filename)
          if (!matched) {
            warnings.push(`"${filename}" not found — option in question ${i + 1} will be imported without media`)
          }
        }
      }
    }

    const built: RawQuestion = {
      qkey,
      type: type as QuestionType,
      text,
      ...(options ? { options } : {}),
      ...(hasMediaFile ? { media_file: q.media_file as string } : {}),
      ...(optionMediaFiles ? { option_media_files: optionMediaFiles } : {}),
    }

    questions.push(built)
  }

  return { questions, error: null, warnings }
}

export function BatchUploadDialog({ onSurveysCreated }: BatchUploadDialogProps) {
  const { user } = useAuthContext()
  const [open, setOpen] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [uploading, setUploading] = useState(false)
  const [demographicKeys, setDemographicKeys] = useState<DemographicKey[]>([])

  useEffect(() => {
    if (!open) return
    supabase
      .from('demographic_keys')
      .select('*')
      .order('key')
      .then(({ data }) => {
        if (data) setDemographicKeys(data as DemographicKey[])
      })
  }, [open])

  const reset = () => {
    setCsvFile(null)
    setMediaFiles([])
    setRows(null)
    setUploading(false)
  }

  const handleOpenChange = (val: boolean) => {
    setOpen(val)
    if (!val) reset()
  }

  const handlePreview = () => {
    if (!csvFile) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
      })

      const parsed: ParsedRow[] = result.data.map((row, idx) => {
        const name = row.name?.trim() ?? ''
        if (!name) {
          return {
            index: idx + 1,
            name: '',
            questions: null,
            demographics: {},
            error: '"name" is required',
            warnings: [],
          }
        }

        let rawQuestions: unknown[]
        try {
          rawQuestions = JSON.parse(row.questions ?? '[]')
        } catch {
          return {
            index: idx + 1,
            name,
            questions: null,
            demographics: {},
            error: 'Failed to parse "questions" as JSON',
            warnings: [],
          }
        }

        let demographics: DemographicFilter = {}
        const demStr = row.demographics?.trim()
        if (demStr) {
          try {
            demographics = JSON.parse(demStr)
          } catch {
            return {
              index: idx + 1,
              name,
              questions: null,
              demographics: {},
              error: 'Failed to parse "demographics" as JSON',
              warnings: [],
            }
          }
        }

        const { questions, error, warnings } = validateAndParseQuestions(rawQuestions, mediaFiles)

        return {
          index: idx + 1,
          name,
          questions: questions as Question[] | null,
          demographics,
          error,
          warnings,
        }
      })

      setRows(parsed)
    }
    reader.readAsText(csvFile)
  }

  const handleImport = async () => {
    if (!user || !rows) return

    const validRows = rows.filter((r) => r.error === null && r.questions !== null)
    if (validRows.length === 0) return

    setUploading(true)
    try {
      // Collect unique media filenames across all valid rows
      const allMediaFilenames = new Set<string>()
      for (const row of validRows) {
        for (const q of row.questions as RawQuestion[]) {
          if (q.media_file) allMediaFilenames.add(q.media_file)
          if (q.option_media_files) {
            for (const f of q.option_media_files) {
              if (f != null) allMediaFilenames.add(f)
            }
          }
        }
      }

      // Upload each unique media file once
      const uploadedMedia: Record<string, MediaAttachment> = {}
      for (const filename of allMediaFilenames) {
        const file = mediaFiles.find((f) => f.name === filename)
        if (file) {
          uploadedMedia[filename] = await uploadMedia(file)
        }
      }

      // Resolve media references and build final question objects
      const surveysToInsert = validRows.map((row) => {
        const resolvedQuestions = (row.questions as RawQuestion[]).map((q) => {
          const { media_file, option_media_files, ...rest } = q

          const media = media_file ? uploadedMedia[media_file] : undefined
          const option_media = option_media_files
            ? option_media_files.map((f) => (f != null ? (uploadedMedia[f] ?? null) : null))
            : undefined

          return {
            ...rest,
            ...(media ? { media } : {}),
            ...(option_media ? { option_media } : {}),
          }
        })

        return {
          user_id: user.id,
          name: row.name,
          questions: resolvedQuestions,
          demographics: row.demographics,
          status: 'draft',
          type: 'survey',
        }
      })

      const { error } = await supabase.from('surveys').insert(surveysToInsert)

      if (error) {
        toast({ title: `Import failed: ${error.message}`, variant: 'destructive' })
      } else {
        toast({ title: `${validRows.length} survey${validRows.length !== 1 ? 's' : ''} created` })
        onSurveysCreated()
        setOpen(false)
        reset()
      }
    } catch (err) {
      toast({
        title: `Import failed: ${err instanceof Error ? err.message : String(err)}`,
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
    }
  }

  const validCount = rows ? rows.filter((r) => r.error === null).length : 0

  const downloadTemplate = () => {
    // Build demographics example from actual keys in the DB
    const buildDemoExample = (): string => {
      if (demographicKeys.length === 0) return '{}'
      const obj: Record<string, unknown> = {}
      for (const dk of demographicKeys) {
        if (dk.value_type === 'numeric') {
          obj[dk.key] = { min: 18, max: 65 }
        } else if (dk.value_type === 'enum' && dk.enum_values?.length) {
          obj[dk.key] = dk.enum_values
        } else {
          obj[dk.key] = []
        }
      }
      return JSON.stringify(obj)
    }

    const csv = (s: string) => `"${s.replace(/"/g, '""')}"`
    const demoEx = buildDemoExample()

    const lines = [
      'name,questions,demographics',
      [
        csv('My Survey'),
        csv('[{"type":"mcq","text":"Do you approve?","options":["Yes","No","No opinion"]}]'),
        csv('{}'),
      ].join(','),
      [
        csv('Music Rating (with audio)'),
        csv('[{"type":"mcq","text":"How does this make you feel?","options":["Negative","Neutral","Positive"],"media_file":"song.wav"}]'),
        csv(demoEx),
      ].join(','),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'surveys_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <Button variant="outline" className="gap-2" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        Upload Surveys
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">Upload Surveys</DialogTitle>
            <DialogDescription>
              Create multiple surveys at once from a CSV file. One row per survey.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* CSV Format Reference */}
            <div className="rounded-xl border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-muted/50 border-b">
                <div>
                  <p className="text-sm font-semibold">CSV Format</p>
                  <p className="text-xs text-muted-foreground">Three columns, one survey per row</p>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={downloadTemplate}>
                  <Download className="h-3.5 w-3.5" />
                  Download template
                </Button>
              </div>

              <div className="divide-y">
                {/* name */}
                <div className="grid grid-cols-[220px_1fr] divide-x">
                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-bold">name</code>
                      <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-md font-semibold">required</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">Survey display name.</p>
                  </div>
                  <div className="p-4 bg-muted/20 flex items-center">
                    <pre className="text-xs text-foreground/75 font-mono">My Survey</pre>
                  </div>
                </div>

                {/* questions */}
                <div className="grid grid-cols-[220px_1fr] divide-x">
                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-bold">questions</code>
                      <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-md font-semibold">required</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      JSON array of question objects. Types:{' '}
                      <code className="bg-muted px-1 rounded text-[11px]">mcq</code>{' '}
                      <code className="bg-muted px-1 rounded text-[11px]">ranking</code>{' '}
                      <code className="bg-muted px-1 rounded text-[11px]">multiple_select</code>{' '}
                      <code className="bg-muted px-1 rounded text-[11px]">open_response</code>
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Do <strong>not</strong> include <code className="bg-muted px-1 rounded text-[11px]">qkey</code> — assigned automatically as q1, q2, …
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Optional: <code className="bg-muted px-1 rounded text-[11px]">media_file</code> (question-level) or <code className="bg-muted px-1 rounded text-[11px]">option_media_files</code> (per-option array).
                    </p>
                  </div>
                  <div className="p-4 bg-muted/20 overflow-x-auto">
                    <pre className="text-xs text-foreground/75 font-mono leading-relaxed">{`[
  {
    "type": "mcq",
    "text": "Do you approve?",
    "options": ["Yes", "No", "No opinion"]
  },
  {
    "type": "mcq",
    "text": "Rate this song",
    "options": ["👍", "👎"],
    "media_file": "song.wav"
  }
]`}</pre>
                  </div>
                </div>

                {/* demographics */}
                <div className="grid grid-cols-[220px_1fr] divide-x">
                  <div className="p-4 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-bold">demographics</code>
                      <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-md font-semibold border">optional</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      JSON filter to restrict which backstories are sampled. Leave empty for no filter.
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                      Only works for dimensions already computed on backstories.{' '}
                      <Link
                        to="/demographic-surveys"
                        className="underline underline-offset-2 font-medium hover:opacity-80 transition-opacity"
                        onClick={() => handleOpenChange(false)}
                      >
                        Set up new dimensions →
                      </Link>
                    </p>
                  </div>
                  <div className="p-4 bg-muted/20 overflow-x-auto">
                    <pre className="text-xs text-foreground/75 font-mono leading-relaxed">{`// no filter
{}

// example filter
{ "c_gender": ["female"],
  "c_age": { "min": 18, "max": 35 } }`}</pre>
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Available keys are included in the downloaded template.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Upload inputs */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Survey CSV</label>
                <label className={`flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-xl px-4 py-5 cursor-pointer transition-colors ${csvFile ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'}`}>
                  <Upload className={`h-5 w-5 ${csvFile ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-xs text-center font-medium">
                    {csvFile ? csvFile.name : 'Click to select CSV'}
                  </span>
                  {csvFile && (
                    <span className="text-[10px] text-muted-foreground">
                      {(csvFile.size / 1024).toFixed(1)} KB
                    </span>
                  )}
                  <input
                    type="file"
                    accept=".csv"
                    className="sr-only"
                    onChange={(e) => {
                      setCsvFile(e.target.files?.[0] ?? null)
                      setRows(null)
                    }}
                  />
                </label>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Audio / Image files{' '}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <label className={`flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-xl px-4 py-5 cursor-pointer transition-colors ${mediaFiles.length > 0 ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'}`}>
                  <Upload className={`h-5 w-5 ${mediaFiles.length > 0 ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-xs text-center font-medium">
                    {mediaFiles.length > 0 ? `${mediaFiles.length} file${mediaFiles.length !== 1 ? 's' : ''} selected` : 'Click to select files'}
                  </span>
                  <span className="text-[10px] text-muted-foreground text-center">
                    Filenames must match CSV exactly (case-sensitive)
                  </span>
                  <input
                    type="file"
                    accept="audio/*,image/*"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      setMediaFiles(Array.from(e.target.files ?? []))
                      setRows(null)
                    }}
                  />
                </label>
              </div>
            </div>

            <Button
              variant="secondary"
              disabled={!csvFile}
              onClick={handlePreview}
              className="w-full"
            >
              Preview
            </Button>

            {rows && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-3 duration-200">
                <p className="text-sm font-medium">
                  Preview —{' '}
                  <span className="text-green-600 dark:text-green-400">{validCount} valid</span>
                  {rows.length - validCount > 0 && (
                    <span className="text-destructive">, {rows.length - validCount} error{rows.length - validCount !== 1 ? 's' : ''}</span>
                  )}
                </p>
                <div className="border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-muted-foreground text-xs">
                      <tr>
                        <th className="text-left px-3 py-2.5 font-medium w-8">#</th>
                        <th className="text-left px-3 py-2.5 font-medium">Name</th>
                        <th className="text-left px-3 py-2.5 font-medium">Questions</th>
                        <th className="text-left px-3 py-2.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((row) => (
                        <tr key={row.index} className="align-top hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-2.5 text-muted-foreground text-xs">{row.index}</td>
                          <td className="px-3 py-2.5 font-medium text-xs">
                            {row.name || <span className="text-muted-foreground italic font-normal">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">
                            {row.questions
                              ? `${row.questions.length} question${row.questions.length !== 1 ? 's' : ''}`
                              : '—'}
                          </td>
                          <td className="px-3 py-2.5 space-y-0.5">
                            {row.error ? (
                              <div className="text-destructive text-xs">✗ {row.error}</div>
                            ) : row.warnings.length > 0 ? (
                              <>
                                <div className="text-green-600 dark:text-green-400 text-xs">✓ Valid</div>
                                {row.warnings.map((w, i) => (
                                  <div key={i} className="text-yellow-600 dark:text-yellow-400 text-xs">⚠ {w}</div>
                                ))}
                              </>
                            ) : (
                              <div className="text-green-600 dark:text-green-400 text-xs">✓ Valid</div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={uploading}>
              Cancel
            </Button>
            {rows && (
              <Button onClick={handleImport} disabled={validCount === 0 || uploading}>
                {uploading
                  ? 'Importing…'
                  : `Import ${validCount} valid survey${validCount !== 1 ? 's' : ''}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
