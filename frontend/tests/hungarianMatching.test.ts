import { describe, it, expect } from 'vitest'
import {
  computeCrossProduct,
  uniformSlotAllocation,
  expandSlots,
  buildCostMatrix,
  hungarianMatch,
  serializeGroup,
  defaultSlotAllocation,
} from '@/lib/hungarianMatching'
import type { Demographics } from '@/types/database'

// ---------- Test backstories ----------

function makeBackstory(
  id: string,
  demos: Record<string, Record<string, number>>
): { id: string; demographics: Demographics } {
  const demographics: Demographics = {}
  for (const [key, dist] of Object.entries(demos)) {
    // Pick the highest-probability value as `value`
    const topEntry = Object.entries(dist).sort((a, b) => b[1] - a[1])[0]
    demographics[key] = { value: topEntry[0], distribution: dist }
  }
  return { id, demographics }
}

const backstories = [
  makeBackstory('a', {
    c_age: { '18-24': 0.8, '25-34': 0.15, '35-44': 0.05 },
    c_gender: { male: 0.9, female: 0.1 },
  }),
  makeBackstory('b', {
    c_age: { '18-24': 0.1, '25-34': 0.7, '35-44': 0.2 },
    c_gender: { male: 0.8, female: 0.2 },
  }),
  makeBackstory('c', {
    c_age: { '18-24': 0.05, '25-34': 0.25, '35-44': 0.7 },
    c_gender: { male: 0.3, female: 0.7 },
  }),
  makeBackstory('d', {
    c_age: { '18-24': 0.7, '25-34': 0.2, '35-44': 0.1 },
    c_gender: { male: 0.15, female: 0.85 },
  }),
  makeBackstory('e', {
    c_age: { '18-24': 0.6, '25-34': 0.3, '35-44': 0.1 },
    c_gender: { male: 0.95, female: 0.05 },
  }),
  makeBackstory('f', {
    c_age: { '18-24': 0.05, '25-34': 0.8, '35-44': 0.15 },
    c_gender: { male: 0.1, female: 0.9 },
  }),
]

// ---------- computeCrossProduct ----------

describe('computeCrossProduct', () => {
  it('correctly enumerates 2-dimension combinations', () => {
    const result = computeCrossProduct({
      c_age: ['18-24', '25-34'],
      c_gender: ['male'],
    })
    expect(result.dimensions).toEqual(['c_age', 'c_gender'])
    expect(result.groups).toHaveLength(2)
    expect(result.groups).toContainEqual({ c_age: '18-24', c_gender: 'male' })
    expect(result.groups).toContainEqual({ c_age: '25-34', c_gender: 'male' })
  })

  it('correctly enumerates larger cross-product', () => {
    const result = computeCrossProduct({
      c_age: ['18-24', '25-34'],
      c_region: ['NE', 'MW'],
    })
    expect(result.dimensions).toEqual(['c_age', 'c_region'])
    expect(result.groups).toHaveLength(4)
  })

  it('skips _sample_size and custom_ keys', () => {
    const result = computeCrossProduct({
      _sample_size: [10] as unknown as string[],
      custom_occupation: ['engineer'],
      c_age: ['18-24'],
    })
    expect(result.dimensions).toEqual(['c_age'])
    expect(result.groups).toHaveLength(1)
  })

  it('returns empty for no active selections', () => {
    const result = computeCrossProduct({ c_age: [], c_gender: undefined })
    expect(result.dimensions).toEqual([])
    expect(result.groups).toEqual([])
  })
})

// ---------- uniformSlotAllocation ----------

describe('uniformSlotAllocation', () => {
  it('distributes K=10 across 3 groups → [4, 3, 3]', () => {
    expect(uniformSlotAllocation(10, 3)).toEqual([4, 3, 3])
  })

  it('distributes K=10 across 4 groups → [3, 3, 2, 2]', () => {
    expect(uniformSlotAllocation(10, 4)).toEqual([3, 3, 2, 2])
  })

  it('distributes K=6 across 3 groups evenly → [2, 2, 2]', () => {
    expect(uniformSlotAllocation(6, 3)).toEqual([2, 2, 2])
  })

  it('handles 0 groups', () => {
    expect(uniformSlotAllocation(10, 0)).toEqual([])
  })
})

// ---------- expandSlots ----------

describe('expandSlots', () => {
  it('generates correct one-hot target vectors from slot allocation', () => {
    const dimensions = ['c_age', 'c_gender']
    const slotAllocation = {
      '18-24|male': 2,
      '25-34|male': 1,
    }

    const targets = expandSlots(slotAllocation, dimensions)
    expect(targets).toHaveLength(3)

    // 2 targets for 18-24|male
    const group1 = targets.filter(
      (t) => t.c_age === '18-24' && t.c_gender === 'male'
    )
    expect(group1).toHaveLength(2)

    // 1 target for 25-34|male
    const group2 = targets.filter(
      (t) => t.c_age === '25-34' && t.c_gender === 'male'
    )
    expect(group2).toHaveLength(1)
  })
})

// ---------- buildCostMatrix ----------

describe('buildCostMatrix', () => {
  it('produces correct K×M matrix', () => {
    const dimensions = ['c_age', 'c_gender']
    const targets = expandSlots({ '18-24|male': 1 }, dimensions)
    const matrix = buildCostMatrix(targets, backstories.slice(0, 2))

    expect(matrix).toHaveLength(1) // 1 slot
    expect(matrix[0]).toHaveLength(2) // 2 backstories

    // Backstory 'a': age 18-24 = 0.8, gender male = 0.9 → 0.72
    expect(matrix[0][0]).toBeCloseTo(0.72)
    // Backstory 'b': age 18-24 = 0.1, gender male = 0.8 → 0.08
    expect(matrix[0][1]).toBeCloseTo(0.08)
  })
})

// ---------- hungarianMatch ----------

describe('hungarianMatch', () => {
  it('returns 1-to-1 assignment (no backstory repeated)', () => {
    const dimensions = ['c_age', 'c_gender']
    const slotAllocation = defaultSlotAllocation(
      computeCrossProduct({ c_age: ['18-24', '25-34'], c_gender: ['male'] }).groups,
      dimensions,
      4
    )

    const results = hungarianMatch(slotAllocation, dimensions, backstories)

    const ids = results.map((r) => r.backstoryId)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length) // No duplicates
  })

  it('with uniform slots across 2 groups returns balanced result', () => {
    const { dimensions, groups } = computeCrossProduct({
      c_age: ['18-24', '25-34'],
      c_gender: ['male'],
    })
    const slotAllocation = defaultSlotAllocation(groups, dimensions, 4)
    // 2 groups × 2 slots each

    const results = hungarianMatch(slotAllocation, dimensions, backstories)

    expect(results).toHaveLength(4) // 4 total assignments

    const group1 = results.filter((r) => r.group === '18-24|male')
    const group2 = results.filter((r) => r.group === '25-34|male')
    expect(group1).toHaveLength(2)
    expect(group2).toHaveLength(2)

    // No overlap between groups
    const ids1 = new Set(group1.map((r) => r.backstoryId))
    const ids2 = new Set(group2.map((r) => r.backstoryId))
    for (const id of ids1) {
      expect(ids2.has(id)).toBe(false)
    }
  })

  it('handles K > M gracefully (more slots than backstories)', () => {
    const dimensions = ['c_age']
    const slotAllocation = { '18-24': 10 } // 10 slots, only 6 backstories

    const results = hungarianMatch(slotAllocation, dimensions, backstories)

    // Can only assign up to 6 (one per backstory)
    expect(results.length).toBeLessThanOrEqual(6)
    // All assignments are unique
    const ids = results.map((r) => r.backstoryId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('with single group degenerates to top-K behavior', () => {
    const dimensions = ['c_age']
    const slotAllocation = { '18-24': 3 }

    const results = hungarianMatch(slotAllocation, dimensions, backstories)

    expect(results).toHaveLength(3)
    // All should be the backstories with highest 18-24 probability
    // a: 0.8, d: 0.7, e: 0.6 — these should be top 3
    const ids = new Set(results.map((r) => r.backstoryId))
    expect(ids.has('a')).toBe(true)
    expect(ids.has('d')).toBe(true)
    expect(ids.has('e')).toBe(true)
  })
})

// ---------- serializeGroup / roundtrip ----------

describe('serializeGroup', () => {
  it('produces deterministic pipe-delimited key', () => {
    const group = { c_age: '18-24', c_gender: 'male', c_region: 'NE' }
    const dimensions = ['c_age', 'c_gender', 'c_region']
    expect(serializeGroup(group, dimensions)).toBe('18-24|male|NE')
  })
})
