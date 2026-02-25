import type { DemographicFilter } from '@/types/database'

/**
 * Fallback demographic prompt preview (mirrors worker/src/prompt.py build_demographic_prompt).
 * No hardcoded keys or values — works with any user-defined demographics.
 * The actual prompt at runtime is LLM-generated; this is for UI preview only.
 */

function keyToLabel(key: string): string {
  const base = key.startsWith('c_') ? key.slice(2) : key
  return base.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function parseFilters(filters: DemographicFilter): { pairs: [string, string][]; isGroup: boolean } {
  const pairs: [string, string][] = []
  let isGroup = false

  for (const key of Object.keys(filters).sort()) {
    const value = filters[key]
    if (value === undefined || value === null) continue

    const label = keyToLabel(key)

    if (Array.isArray(value)) {
      const vals = value.map(String).filter((v) => v)
      if (vals.length === 0) continue
      if (vals.length > 1) isGroup = true
      pairs.push([label, vals.join(' or ')])
    } else if (typeof value === 'object') {
      const { min, max } = value as { min?: number; max?: number }
      if (min !== undefined && max !== undefined) pairs.push([label, `${min}-${max}`])
      else if (min !== undefined) pairs.push([label, `${min}+`])
      else if (max !== undefined) pairs.push([label, `under ${max}`])
    } else {
      pairs.push([label, String(value)])
    }
  }

  return { pairs, isGroup }
}

export function buildDemographicPromptText(filters: DemographicFilter): string {
  const { pairs, isGroup } = parseFilters(filters)
  if (pairs.length === 0) return 'You are a person.'

  const desc = pairs.map(([label, val]) => `${label}: ${val}`).join(', ')

  if (isGroup) {
    return (
      `You are one person from a group with these characteristics: ${desc}. ` +
      'Answer as if you are one specific person from this group.'
    )
  }
  return `You are a person with these characteristics: ${desc}.`
}
