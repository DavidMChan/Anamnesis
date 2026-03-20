import { useState } from 'react'
import Papa from 'papaparse'
import { Upload } from 'lucide-react'
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
import type { Question, QuestionType, DemographicFilter, MediaAttachment } from '@/types/database'

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

  return (
    <>
      <Button variant="outline" className="gap-2" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        Upload Surveys
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload Surveys</DialogTitle>
            <DialogDescription>
              One row per survey. Required columns: <code>name</code>, <code>questions</code> (JSON
              array), <code>demographics</code> (JSON, optional). Do NOT include <code>qkey</code>{' '}
              in question objects — it is assigned automatically (q1, q2, …). If questions reference
              audio/image files via <code>media_file</code> or <code>option_media_files</code>,
              select those files below. Unmatched files will be imported without media (warning
              shown).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Survey CSV</label>
              <input
                type="file"
                accept=".csv"
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-muted file:text-foreground hover:file:bg-muted/80 cursor-pointer"
                onChange={(e) => {
                  setCsvFile(e.target.files?.[0] ?? null)
                  setRows(null)
                }}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Audio / Image files{' '}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                type="file"
                accept="audio/*,image/*"
                multiple
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-muted file:text-foreground hover:file:bg-muted/80 cursor-pointer"
                onChange={(e) => {
                  setMediaFiles(Array.from(e.target.files ?? []))
                  setRows(null)
                }}
              />
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
              <div className="space-y-2">
                <p className="text-sm font-medium">Preview ({rows.length} rows)</p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium w-8">#</th>
                        <th className="text-left px-3 py-2 font-medium">Name</th>
                        <th className="text-left px-3 py-2 font-medium">Questions</th>
                        <th className="text-left px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((row) => (
                        <tr key={row.index} className="align-top">
                          <td className="px-3 py-2 text-muted-foreground">{row.index}</td>
                          <td className="px-3 py-2">
                            {row.name || (
                              <span className="text-muted-foreground italic">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {row.questions
                              ? `${row.questions.length} question${row.questions.length !== 1 ? 's' : ''}`
                              : '—'}
                          </td>
                          <td className="px-3 py-2 space-y-1">
                            {row.error ? (
                              <div className="text-destructive text-xs">✗ {row.error}</div>
                            ) : row.warnings.length > 0 ? (
                              <div className="space-y-0.5">
                                {row.warnings.map((w, i) => (
                                  <div
                                    key={i}
                                    className="text-yellow-600 dark:text-yellow-400 text-xs"
                                  >
                                    ⚠ {w}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-green-600 dark:text-green-400 text-xs">
                                ✓ Valid
                              </div>
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
