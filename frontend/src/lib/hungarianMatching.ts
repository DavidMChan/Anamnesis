/**
 * Hungarian (Munkres) algorithm wrapper for balanced demographic matching.
 *
 * Expands slot allocations into one-hot targets, builds a cost matrix,
 * and runs the Hungarian algorithm to produce optimal 1-to-1 assignments.
 */
import type { Demographics, DemographicFilter } from '@/types/database'
import { scoreBackstoryOneHot } from './backstoryScoring'
import computeMunkres from 'munkres-js'

// ---------- Cross-product & slot allocation ----------

/**
 * Compute the cross-product of selected categories across dimensions.
 *
 * Input:  { c_age: ["18-24","25-34"], c_gender: ["male"], c_region: ["NE","MW"] }
 * Output: [
 *   { c_age: "18-24", c_gender: "male", c_region: "NE" },
 *   { c_age: "18-24", c_gender: "male", c_region: "MW" },
 *   { c_age: "25-34", c_gender: "male", c_region: "NE" },
 *   { c_age: "25-34", c_gender: "male", c_region: "MW" },
 * ]
 *
 * Skips dimensions with empty/undefined selections, _sample_size, and custom_ keys.
 */
export function computeCrossProduct(
  filters: DemographicFilter
): { dimensions: string[]; groups: Record<string, string>[] } {
  const dimensions: string[] = []
  const valueArrays: string[][] = []

  for (const [key, val] of Object.entries(filters)) {
    if (key === '_sample_size') continue
    if (key.startsWith('custom_')) continue
    if (!val || !Array.isArray(val) || val.length === 0) continue

    dimensions.push(key)
    valueArrays.push(val as string[])
  }

  if (dimensions.length === 0) {
    return { dimensions: [], groups: [] }
  }

  // Cartesian product
  let groups: Record<string, string>[] = [{}]
  for (let i = 0; i < dimensions.length; i++) {
    const dim = dimensions[i]
    const values = valueArrays[i]
    const next: Record<string, string>[] = []
    for (const group of groups) {
      for (const v of values) {
        next.push({ ...group, [dim]: v })
      }
    }
    groups = next
  }

  return { dimensions, groups }
}

/**
 * Serialize a group to a pipe-delimited key.
 * Uses the provided dimension order for deterministic keys.
 */
export function serializeGroup(
  group: Record<string, string>,
  dimensions: string[]
): string {
  return dimensions.map((d) => group[d]).join('|')
}

/**
 * Deserialize a pipe-delimited group key back to a Record.
 */
export function deserializeGroup(
  key: string,
  dimensions: string[]
): Record<string, string> {
  const values = key.split('|')
  const group: Record<string, string> = {}
  for (let i = 0; i < dimensions.length; i++) {
    group[dimensions[i]] = values[i]
  }
  return group
}

/**
 * Distribute K slots uniformly across numGroups groups.
 * Remainder goes to the first groups.
 *
 * K=10, 3 groups → [4, 3, 3]
 * K=10, 4 groups → [3, 3, 2, 2]
 */
export function uniformSlotAllocation(K: number, numGroups: number): number[] {
  if (numGroups === 0) return []
  const base = Math.floor(K / numGroups)
  const remainder = K % numGroups
  return Array.from({ length: numGroups }, (_, i) =>
    i < remainder ? base + 1 : base
  )
}

/**
 * Create a default (uniform) slot allocation map from groups and K.
 */
export function defaultSlotAllocation(
  groups: Record<string, string>[],
  dimensions: string[],
  K: number
): Record<string, number> {
  const counts = uniformSlotAllocation(K, groups.length)
  const allocation: Record<string, number> = {}
  for (let i = 0; i < groups.length; i++) {
    allocation[serializeGroup(groups[i], dimensions)] = counts[i]
  }
  return allocation
}

// ---------- Slot expansion & cost matrix ----------

/**
 * Expand slot allocation into an array of one-hot target vectors.
 *
 * Each slot becomes a Record<string, string> mapping dimension → category.
 * If a group has N slots, N identical target vectors are emitted.
 */
export function expandSlots(
  slotAllocation: Record<string, number>,
  dimensions: string[]
): Record<string, string>[] {
  const targets: Record<string, string>[] = []

  for (const [key, count] of Object.entries(slotAllocation)) {
    const group = deserializeGroup(key, dimensions)
    for (let i = 0; i < count; i++) {
      targets.push({ ...group })
    }
  }

  return targets
}

/**
 * Build a K × M cost matrix.
 * cost[slot_i][backstory_j] = product of distribution[target_category] per dimension
 */
export function buildCostMatrix(
  targets: Record<string, string>[],
  backstories: { id: string; demographics: Demographics }[]
): number[][] {
  return targets.map((target) =>
    backstories.map((b) => scoreBackstoryOneHot(b.demographics, target))
  )
}

// ---------- Hungarian matching ----------

export interface MatchResult {
  backstoryId: string
  group: string // pipe-delimited group key
  score: number
}

/**
 * Run Hungarian matching: assign backstories to slots optimally.
 *
 * When K > M (more slots than backstories), we pad the cost matrix
 * with dummy columns (score 0) so the algorithm can run, then filter
 * out dummy assignments.
 */
export function hungarianMatch(
  slotAllocation: Record<string, number>,
  dimensions: string[],
  backstories: { id: string; demographics: Demographics }[]
): MatchResult[] {
  const targets = expandSlots(slotAllocation, dimensions)
  const K = targets.length

  if (K === 0 || backstories.length === 0) return []

  // For each unique target group, keep only the top CANDIDATES_PER_GROUP backstories
  // by score. Take the union across all groups. This bounds M to at most
  // K * CANDIDATES_PER_GROUP, keeping the cost matrix small regardless of pool size.
  const CANDIDATES_PER_GROUP = 50
  const uniqueTargets = Array.from(
    new Map(targets.map((t) => [JSON.stringify(t), t])).values()
  )
  const candidateSet = new Map<string, { id: string; demographics: Demographics }>()
  for (const target of uniqueTargets) {
    const scored = backstories
      .map((b) => ({ b, score: scoreBackstoryOneHot(b.demographics, target) }))
      .filter((x) => x.score > 0)
      .sort((a, z) => z.score - a.score)
      .slice(0, CANDIDATES_PER_GROUP)
    for (const { b } of scored) {
      candidateSet.set(b.id, b)
    }
  }
  const candidates = Array.from(candidateSet.values())
  if (candidates.length === 0) return []

  const M = candidates.length

  const costMatrix = buildCostMatrix(targets, candidates)

  // Munkres minimizes cost. We want to maximize score — negate.
  let maxVal = 0
  for (const row of costMatrix) {
    for (const val of row) {
      if (val > maxVal) maxVal = val
    }
  }
  const negatedMatrix = costMatrix.map((row) =>
    row.map((val) => maxVal - val)
  )

  // If K > M, pad columns with high cost (maxVal) so they're never preferred
  if (K > M) {
    for (const row of negatedMatrix) {
      for (let j = M; j < K; j++) {
        row.push(maxVal)
      }
    }
  }

  const assignments: [number, number][] = computeMunkres(negatedMatrix)

  const results: MatchResult[] = []
  const usedBackstories = new Set<string>()

  for (const [slotIdx, backstoryIdx] of assignments) {
    // Skip dummy column assignments (when K > M)
    if (backstoryIdx >= M) continue
    // Skip if slotIdx is out of range (shouldn't happen)
    if (slotIdx >= K) continue

    const backstory = candidates[backstoryIdx]
    // Skip if already assigned (shouldn't happen with Hungarian)
    if (usedBackstories.has(backstory.id)) continue

    usedBackstories.add(backstory.id)
    const target = targets[slotIdx]
    const groupKey = serializeGroup(target, dimensions)

    results.push({
      backstoryId: backstory.id,
      group: groupKey,
      score: costMatrix[slotIdx][backstoryIdx],
    })
  }

  return results
}
