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

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const BACKSTORY_PAGE_SIZE = 5000
const SIMPLE_DEMOGRAPHIC_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

function getActiveDemographicKeys(filters: DemographicFilter): string[] {
  const keys = new Set<string>()

  for (const [key, filterValue] of Object.entries(filters)) {
    if (key === '_sample_size') continue
    if (!filterValue || !Array.isArray(filterValue) || filterValue.length === 0) continue

    keys.add(key.startsWith('custom_') ? key.replace('custom_', '') : key)
  }

  return Array.from(keys)
}

async function fetchAllPublicBackstoryIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('backstories')
    .select('id')
    .eq('is_public', true)
    .neq('source_type', 'anthology')
    .order('id', { ascending: true })

  if (error) throw new Error(error.message)
  return (data || []).map((b) => b.id)
}

/**
 * Fetch all public backstories with demographics (excluding anthology).
 * Returns id + only the demographic keys needed for client-side scoring.
 */
async function fetchBackstoriesWithDemographics(
  demographicKeys: string[]
): Promise<{ id: string; demographics: Demographics }[]> {
  const uniqueKeys = Array.from(new Set(demographicKeys)).filter(Boolean)

  // PostgREST JSON-path projection needs simple aliases. Fall back to the full
  // JSONB column for unusual user-defined keys rather than generating bad SQL.
  const canProjectKeys = uniqueKeys.every((key) => SIMPLE_DEMOGRAPHIC_KEY.test(key))
  const selectClause = canProjectKeys && uniqueKeys.length > 0
    ? ['id', ...uniqueKeys.map((key) => `${key}:demographics->${key}`)].join(', ')
    : 'id, demographics'

  const backstories: { id: string; demographics: Demographics }[] = []

  for (let from = 0; ; from += BACKSTORY_PAGE_SIZE) {
    const to = from + BACKSTORY_PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('backstories')
      .select(selectClause)
      .eq('is_public', true)
      .neq('source_type', 'anthology')
      .order('id', { ascending: true })
      .range(from, to)

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    const rows = data as unknown as Array<Record<string, unknown> & { id: string; demographics?: Demographics }>
    backstories.push(
      ...rows.map((row) => {
        if (!canProjectKeys) {
          return {
            id: row.id,
            demographics: (row.demographics || {}) as Demographics,
          }
        }

        const demographics: Demographics = {}
        for (const key of uniqueKeys) {
          const value = row[key]
          if (value) {
            demographics[key] = value as Demographics[string]
          }
        }
        return { id: row.id, demographics }
      })
    )

    if (data.length < BACKSTORY_PAGE_SIZE) break
  }

  return backstories
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
  const activeKeys = getActiveDemographicKeys(config.filters)
  const sampleLimit = config.sample_size > 0 ? config.sample_size : undefined

  if (activeKeys.length === 0) {
    const ids = await fetchAllPublicBackstoryIds()
    const selected = sampleLimit ? shuffle(ids).slice(0, sampleLimit) : shuffle(ids)
    console.log(`[selectBackstoryIds] pool size: ${ids.length}`)
    console.log(`[selectBackstoryIds] ${config.mode}, no filters -> random sample of ${selected.length}`)
    return selected
  }

  let backstories = await fetchBackstoriesWithDemographics(activeKeys)
  console.log(`[selectBackstoryIds] pool size: ${backstories.length}`)

  // Apply custom_ filters first (exact match)
  backstories = applyCustomFilters(backstories, config.filters)
  if (activeKeys.some((key) => config.filters[`custom_${key}`])) {
    console.log(`[selectBackstoryIds] after custom filters: ${backstories.length}`)
  }

  if (config.mode === 'top_k') {
    if (Object.keys(config.filters).length === 0) {
      const selected = sampleLimit ? shuffle(backstories).slice(0, sampleLimit) : shuffle(backstories)
      console.log(`[selectBackstoryIds] top_k, no filters → random sample of ${selected.length}`)
      return selected.map((b) => b.id)
    }
    const scored = rankAndSelectBackstories(backstories, config.filters, sampleLimit)
    console.log(`[selectBackstoryIds] top_k, filters=${JSON.stringify(config.filters)}`)
    console.log(`[selectBackstoryIds] top scores:`, scored.slice(0, 5).map((s) => ({ id: s.id, score: s.score })))
    return scored.map((s) => s.id)
  }

  // Balanced matching
  const { dimensions, groups } = computeCrossProduct(config.filters)
  console.log(`[selectBackstoryIds] balanced, dimensions=${JSON.stringify(dimensions)}, groups=${groups.length}`)

  if (groups.length === 0) {
    const selected = sampleLimit ? shuffle(backstories).slice(0, sampleLimit) : shuffle(backstories)
    console.log(`[selectBackstoryIds] balanced, no filters → random sample of ${selected.length}`)
    return selected.map((b) => b.id)
  }

  const balancedSampleSize = sampleLimit ?? backstories.length
  const slotAllocation =
    config.slot_allocation ??
    defaultSlotAllocation(groups, dimensions, balancedSampleSize)
  console.log(`[selectBackstoryIds] slot allocation:`, slotAllocation)

  const results = hungarianMatch(slotAllocation, dimensions, backstories)
  console.log(`[selectBackstoryIds] hungarian results:`, results.map((r) => ({ id: r.backstoryId, group: r.group, score: r.score })))
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
