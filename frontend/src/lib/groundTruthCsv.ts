/**
 * Ground Truth CSV parser.
 *
 * Researchers upload a CSV of real respondents with:
 *   - exact-name demographic columns (must match demographic_keys.key)
 *   - optional q<qkey> columns with the respondent's ground truth answers
 *   - optional `_id` column for stable respondent IDs
 *   - optional `_count` column for aggregate mode (one row = many respondents)
 *
 * Refused / NA / empty values cause that dimension to be DROPPED from the
 * respondent's target vector. The matcher then ignores that dimension when
 * computing edge weight to backstories. This matches the anthology paper:
 * a uniform distribution on the missing trait yields equivalent relative
 * ranking when probabilities are multiplied across traits.
 */
import Papa from 'papaparse'
import type {
  GroundTruthMode,
  GroundTruthRespondent,
  Question,
} from '@/types/database'

// Tokens that mean "no value for this dimension; drop it from matching".
const REFUSED_TOKENS = new Set([
  '',
  'na',
  'n/a',
  'nan',
  'null',
  'refused',
  'prefer not to say',
  'unknown',
])

function isRefused(raw: string | undefined | null): boolean {
  if (raw === undefined || raw === null) return true
  return REFUSED_TOKENS.has(raw.trim().toLowerCase())
}

export interface ParsedRowIssue {
  level: 'warning' | 'error'
  message: string
}

export interface ParsedGroundTruthRow {
  index: number // 1-based row index in the CSV
  respondent: GroundTruthRespondent | null
  issues: ParsedRowIssue[]
}

export interface GroundTruthParseResult {
  mode: GroundTruthMode
  // Headers that are valid demographic dimensions present in this upload.
  demographicKeys: string[]
  // Headers prefixed with `q` that map to valid survey qkeys (without the `q`).
  questionKeys: string[]
  // Headers we couldn't classify (not _id/_count, not demographic, not a known qkey).
  unknownHeaders: string[]
  rows: ParsedGroundTruthRow[]
  // Aggregate stats for the UI summary.
  stats: {
    totalRows: number
    validRows: number
    errorRows: number
    droppedDimensions: Record<string, number> // dimension -> how many rows dropped it
    totalRespondents: number // sum of _count when aggregate, else validRows
  }
  // Top-level errors (e.g. missing required columns)
  fatalError: string | null
}

export interface GroundTruthParseInput {
  csvText: string
  // The valid demographic keys (from demographic_keys table). Anything not in
  // this set is treated as an unknown header.
  knownDemographicKeys: Set<string>
  // The questions on the linked survey. CSV columns named `q<qkey>` are
  // matched (case-sensitive) against question.qkey.
  surveyQuestions: Question[]
}

/**
 * Parse a Ground Truth CSV upload.
 *
 * - `_id`: optional, falls back to a row-index string.
 * - `_count`: presence anywhere flips the whole file to aggregate mode.
 * - `q<qkey>`: ground truth answer; must exist on the survey.
 * - Other columns: must exactly match a key in `knownDemographicKeys`.
 */
export function parseGroundTruthCsv(
  input: GroundTruthParseInput,
): GroundTruthParseResult {
  const { csvText, knownDemographicKeys, surveyQuestions } = input

  const surveyQkeys = new Set(surveyQuestions.map((q) => q.qkey))
  const multiSelectQkeys = new Set(
    surveyQuestions.filter((q) => q.type === 'multiple_select').map((q) => q.qkey),
  )

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return emptyResult(`CSV parse error: ${parsed.errors[0].message}`)
  }

  const headers = parsed.meta.fields ?? []
  if (headers.length === 0) {
    return emptyResult('CSV has no headers.')
  }

  const hasCount = headers.includes('_count')
  const mode: GroundTruthMode = hasCount ? 'aggregate' : 'per_respondent'

  const demographicKeys: string[] = []
  const questionKeys: string[] = []
  const unknownHeaders: string[] = []

  for (const h of headers) {
    if (h === '_id' || h === '_count') continue
    if (h.startsWith('q') && surveyQkeys.has(h.slice(1))) {
      questionKeys.push(h.slice(1))
      continue
    }
    if (knownDemographicKeys.has(h)) {
      demographicKeys.push(h)
      continue
    }
    unknownHeaders.push(h)
  }

  if (demographicKeys.length === 0) {
    return emptyResult(
      'No recognized demographic columns. Column headers must exactly match keys defined in Demographics.',
    )
  }

  const droppedDimensions: Record<string, number> = {}
  const rows: ParsedGroundTruthRow[] = []
  let totalRespondents = 0
  let validRows = 0
  let errorRows = 0

  parsed.data.forEach((raw, idx) => {
    const rowNumber = idx + 1
    const issues: ParsedRowIssue[] = []

    // Resolve _id
    const rawId = raw['_id']?.trim()
    const respondentId = rawId && rawId.length > 0 ? rawId : `row_${rowNumber}`

    // Resolve _count for aggregate mode.
    let count = 1
    if (mode === 'aggregate') {
      const rawCount = raw['_count']?.trim()
      const parsedCount = rawCount ? Number(rawCount) : NaN
      if (!Number.isFinite(parsedCount) || parsedCount <= 0 || !Number.isInteger(parsedCount)) {
        issues.push({
          level: 'error',
          message: `"_count" must be a positive integer (got: "${rawCount ?? ''}")`,
        })
      } else {
        count = parsedCount
      }
    }

    // Collect demographics, dropping refused ones.
    const demographics: Record<string, string> = {}
    for (const key of demographicKeys) {
      const value = raw[key]
      if (isRefused(value)) {
        droppedDimensions[key] = (droppedDimensions[key] ?? 0) + 1
        continue
      }
      demographics[key] = value.trim()
    }

    if (Object.keys(demographics).length === 0) {
      issues.push({
        level: 'error',
        message: 'All demographic values are empty / refused; cannot match this row.',
      })
    }

    // Collect ground truth answers.
    const answers: Record<string, string | string[]> = {}
    for (const qkey of questionKeys) {
      const value = raw[`q${qkey}`]
      if (value === undefined || value === null || value.trim() === '') continue
      const trimmed = value.trim()
      if (multiSelectQkeys.has(qkey)) {
        // Split on '|' or ';' (common encodings for multi-select cells).
        answers[qkey] = trimmed
          .split(/[|;]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      } else {
        answers[qkey] = trimmed
      }
    }

    const hasError = issues.some((i) => i.level === 'error')
    if (hasError) {
      errorRows += 1
      rows.push({ index: rowNumber, respondent: null, issues })
      return
    }

    const respondent: GroundTruthRespondent = {
      _id: respondentId,
      demographics,
    }
    if (mode === 'aggregate') respondent._count = count
    if (Object.keys(answers).length > 0) respondent.answers = answers

    validRows += 1
    totalRespondents += count
    rows.push({ index: rowNumber, respondent, issues })
  })

  return {
    mode,
    demographicKeys,
    questionKeys,
    unknownHeaders,
    rows,
    stats: {
      totalRows: parsed.data.length,
      validRows,
      errorRows,
      droppedDimensions,
      totalRespondents,
    },
    fatalError: null,
  }
}

function emptyResult(fatalError: string): GroundTruthParseResult {
  return {
    mode: 'per_respondent',
    demographicKeys: [],
    questionKeys: [],
    unknownHeaders: [],
    rows: [],
    stats: {
      totalRows: 0,
      validRows: 0,
      errorRows: 0,
      droppedDimensions: {},
      totalRespondents: 0,
    },
    fatalError,
  }
}

/**
 * Extract just the valid respondents (drops rows with errors).
 */
export function validRespondents(result: GroundTruthParseResult): GroundTruthRespondent[] {
  return result.rows
    .map((r) => r.respondent)
    .filter((r): r is GroundTruthRespondent => r !== null)
}
