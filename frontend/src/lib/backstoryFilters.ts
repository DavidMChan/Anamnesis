/**
 * Shared utility: apply demographic filters to a Supabase backstory query.
 *
 * Backstory demographics are JSONB with structure:
 *   { "c_age": { "value": "25-34", "distribution": {...} }, ... }
 *
 * DemographicFilter is:
 *   { "c_age": ["25-34", "35-44"], "c_gender": ["Male"], ... }
 *
 * This function adds `.in(demographics->{key}->>value, values)` for each active filter.
 */
import type { DemographicFilter } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyDemographicFilters(query: any, filters: DemographicFilter) {
  for (const [key, filterValue] of Object.entries(filters)) {
    if (!filterValue || !Array.isArray(filterValue) || filterValue.length === 0) continue
    if (key === '_sample_size') continue // internal metadata, not a filter

    const demographicKey = key.startsWith('custom_') ? key.replace('custom_', '') : key
    query = query.in(`demographics->${demographicKey}->>value`, filterValue)
  }
  return query
}
