/**
 * Backstory filtering and selection.
 *
 * Supports two modes:
 * 1. Top-K Probability: scores backstories by joint probability, selects highest K
 * 2. Balanced Matching: uses Hungarian algorithm for optimal slot assignment
 *
 * Also supports legacy value-based filtering for backward compatibility.
 */
import { supabase } from './supabase'
import { rankAndSelectBackstories } from './backstoryScoring'
import { computeCrossProduct, defaultSlotAllocation, hungarianMatch } from './hungarianMatching'
import type {
  DemographicFilter,
  DemographicSelectionConfig,
  Demographics,
} from '@/types/database'

/**
 * Type guard: is the demographics column using the new selection config format?
 */
export function isDemographicSelectionConfig(
  value: DemographicFilter | DemographicSelectionConfig | undefined
): value is DemographicSelectionConfig {
  return !!value && 'mode' in value && 'filters' in value
}

/**
 * Fetch all public backstories with demographics (excluding anthology).
 * Returns id + demographics for client-side scoring.
 */
async function fetchBackstoriesWithDemographics(): Promise<
  { id: string; demographics: Demographics }[]
> {
  const { data, error } = await supabase
    .from('backstories')
    .select('id, demographics')
    .eq('is_public', true)
    .neq('source_type', 'anthology')

  if (error) throw new Error(error.message)
  return (data || []).filter((b) => b.demographics) as {
    id: string
    demographics: Demographics
  }[]
}

/**
 * Apply custom_* filters (exact value match) to backstory list.
 */
function applyCustomFilters(
  backstories: { id: string; demographics: Demographics }[],
  filters: DemographicFilter
): { id: string; demographics: Demographics }[] {
  const customEntries = Object.entries(filters).filter(
    ([key, val]) =>
      key.startsWith('custom_') && Array.isArray(val) && val.length > 0
  )

  if (customEntries.length === 0) return backstories

  return backstories.filter((b) => {
    for (const [key, vals] of customEntries) {
      const demoKey = key.replace('custom_', '')
      const dim = b.demographics[demoKey]
      if (!dim || !dim.value || !(vals as string[]).includes(dim.value)) {
        return false
      }
    }
    return true
  })
}

/**
 * Select backstory IDs using the new distribution-based selection.
 */
export async function selectBackstoryIds(
  config: DemographicSelectionConfig
): Promise<string[]> {
  let backstories = await fetchBackstoriesWithDemographics()

  // Apply custom_ filters first (exact match)
  backstories = applyCustomFilters(backstories, config.filters)

  if (config.mode === 'top_k') {
    const scored = rankAndSelectBackstories(
      backstories,
      config.filters,
      config.sample_size
    )
    return scored.map((s) => s.id)
  }

  // Balanced matching
  const { dimensions, groups } = computeCrossProduct(config.filters)

  if (groups.length === 0) {
    // No demographic filters active — just return top K by any criteria
    return backstories.slice(0, config.sample_size).map((b) => b.id)
  }

  const slotAllocation =
    config.slot_allocation ??
    defaultSlotAllocation(groups, dimensions, config.sample_size)

  const results = hungarianMatch(slotAllocation, dimensions, backstories)
  return results.map((r) => r.backstoryId)
}

/**
 * Legacy: apply demographic filters to a Supabase query using value matching.
 * Kept for backward compatibility with old survey runs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyDemographicFilters(query: any, filters: DemographicFilter) {
  for (const [key, filterValue] of Object.entries(filters)) {
    if (!filterValue || !Array.isArray(filterValue) || filterValue.length === 0) continue
    if (key === '_sample_size') continue

    const demographicKey = key.startsWith('custom_') ? key.replace('custom_', '') : key

    if (Array.isArray(filterValue)) {
      query = query.in(`demographics->${demographicKey}->>value`, filterValue)
    } else if (typeof filterValue === 'object') {
      const { min, max } = filterValue
      if (min !== undefined) {
        query = query.gte(`demographics->${demographicKey}->>value`, min)
      }
      if (max !== undefined) {
        query = query.lte(`demographics->${demographicKey}->>value`, max)
      }
    }
  }
  return query
}
