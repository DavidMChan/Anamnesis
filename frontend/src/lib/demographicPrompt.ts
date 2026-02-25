import type { DemographicFilter } from '@/types/database'

/**
 * Build a zero-shot demographic prompt text from a DemographicFilter.
 *
 * Logic (identical to worker/src/prompt.py build_demographic_prompt):
 *   - Keys are processed in sorted order for determinism
 *   - "c_" prefix is stripped → dimension name
 *   - Keys containing "age" get "year old" suffix
 *   - {min, max} → "{min}-{max} year old" / "{min}-{max} {dimName}"
 *   - {min} only → "{min}+ year old" / "{min}+ {dimName}"
 *   - {max} only → "under {max} year old" / "under {max} {dimName}"
 *   - string[] single → value as-is
 *   - string[] multiple → joined with " or "
 *
 * Returns "You are a {descriptors}." or "You are a person." if empty.
 */
export function buildDemographicPromptText(filters: DemographicFilter): string {
  const keys = Object.keys(filters).sort()
  const descriptors: string[] = []

  for (const key of keys) {
    const value = filters[key]
    if (value === undefined) continue

    const dimName = key.startsWith('c_') ? key.slice(2) : key
    const isAge = dimName.includes('age')

    if (Array.isArray(value)) {
      if (value.length === 0) continue
      if (value.length === 1) {
        descriptors.push(value[0])
      } else {
        descriptors.push(value.join(' or '))
      }
    } else if (typeof value === 'object' && value !== null) {
      const { min, max } = value as { min?: number; max?: number }
      if (min !== undefined && max !== undefined) {
        descriptors.push(isAge ? `${min}-${max} year old` : `${min}-${max} ${dimName}`)
      } else if (min !== undefined) {
        descriptors.push(isAge ? `${min}+ year old` : `${min}+ ${dimName}`)
      } else if (max !== undefined) {
        descriptors.push(isAge ? `under ${max} year old` : `under ${max} ${dimName}`)
      }
    }
  }

  if (descriptors.length === 0) {
    return 'You are a person.'
  }

  return `You are a ${descriptors.join(' ')}.`
}
