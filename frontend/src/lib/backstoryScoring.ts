/**
 * Distribution-based backstory scoring.
 *
 * Scores backstories by joint probability across selected demographic categories.
 * Used by both Top-K and Balanced Matching modes.
 */
import type { Demographics, DemographicFilter } from '@/types/database'

export interface ScoredBackstory {
  id: string
  score: number
}

/**
 * Score a single backstory against a demographic filter.
 *
 * For each dimension in the filter, sum the distribution probabilities
 * for all selected categories. Then multiply across dimensions.
 *
 * Returns 1.0 when no filters are active (empty filter).
 * Returns 0 when a selected category has zero probability or the
 * dimension is missing entirely from the backstory.
 */
export function scoreBackstory(
  demographics: Demographics,
  filters: DemographicFilter
): number {
  let score = 1.0

  for (const [key, filterValue] of Object.entries(filters)) {
    // Skip internal metadata and inactive filters
    if (key === '_sample_size') continue
    if (!filterValue || !Array.isArray(filterValue) || filterValue.length === 0) continue
    // Skip custom filters — these use exact match, not distribution scoring
    if (key.startsWith('custom_')) continue

    const dimension = demographics[key]
    if (!dimension || !dimension.distribution) {
      return 0
    }

    // Sum probabilities for all selected categories in this dimension
    let dimScore = 0
    for (const cat of filterValue as string[]) {
      dimScore += dimension.distribution[cat] ?? 0
    }

    score *= dimScore
  }

  return score
}

/**
 * Score a single backstory against a one-hot target (for balanced matching).
 *
 * Each dimension has exactly one target category. The score is the product
 * of the distribution probability for each target category.
 */
export function scoreBackstoryOneHot(
  demographics: Demographics,
  target: Record<string, string>
): number {
  let score = 1.0

  for (const [key, category] of Object.entries(target)) {
    const dimension = demographics[key]
    if (!dimension || !dimension.distribution) {
      return 0
    }
    score *= dimension.distribution[category] ?? 0
  }

  return score
}

/**
 * Rank backstories by score and return the top K.
 * Excludes backstories with score = 0.
 */
export function rankAndSelectBackstories(
  backstories: { id: string; demographics: Demographics }[],
  filters: DemographicFilter,
  topK?: number
): ScoredBackstory[] {
  const scored: ScoredBackstory[] = backstories
    .map((b) => ({
      id: b.id,
      score: scoreBackstory(b.demographics, filters),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)

  if (topK !== undefined && topK > 0) {
    return scored.slice(0, topK)
  }

  return scored
}
