import { describe, it, expect } from 'vitest'
import { scoreBackstory, rankAndSelectBackstories } from '@/lib/backstoryScoring'
import type { Demographics, DemographicFilter } from '@/types/database'

// ---------- Test data ----------

const demoA: Demographics = {
  c_age: { value: '18-24', distribution: { '18-24': 0.8, '25-34': 0.15, '35-44': 0.05 } },
  c_gender: { value: 'male', distribution: { male: 0.9, female: 0.1 } },
  c_region: { value: 'NE', distribution: { NE: 0.7, MW: 0.2, S: 0.05, W: 0.05 } },
}

const demoB: Demographics = {
  c_age: { value: '25-34', distribution: { '18-24': 0.1, '25-34': 0.7, '35-44': 0.2 } },
  c_gender: { value: 'male', distribution: { male: 0.8, female: 0.2 } },
  c_region: { value: 'MW', distribution: { NE: 0.1, MW: 0.6, S: 0.2, W: 0.1 } },
}

const demoC: Demographics = {
  c_age: { value: '35-44', distribution: { '18-24': 0.0, '25-34': 0.3, '35-44': 0.7 } },
  c_gender: { value: 'female', distribution: { male: 0.4, female: 0.6 } },
}

const backstories = [
  { id: 'a', demographics: demoA },
  { id: 'b', demographics: demoB },
  { id: 'c', demographics: demoC },
]

// ---------- scoreBackstory ----------

describe('scoreBackstory', () => {
  it('returns 1.0 when no filters are active (empty filter)', () => {
    expect(scoreBackstory(demoA, {})).toBe(1.0)
  })

  it('single dimension, single category: returns that category probability', () => {
    const filters: DemographicFilter = { c_age: ['18-24'] }
    expect(scoreBackstory(demoA, filters)).toBeCloseTo(0.8)
  })

  it('single dimension, multiple categories: returns sum of probabilities', () => {
    const filters: DemographicFilter = { c_age: ['18-24', '25-34'] }
    // 0.8 + 0.15 = 0.95
    expect(scoreBackstory(demoA, filters)).toBeCloseTo(0.95)
  })

  it('multiple dimensions: returns product of per-dimension scores', () => {
    const filters: DemographicFilter = {
      c_age: ['18-24'],
      c_gender: ['male'],
    }
    // 0.8 * 0.9 = 0.72
    expect(scoreBackstory(demoA, filters)).toBeCloseTo(0.72)
  })

  it('returns 0 when selected category has zero probability', () => {
    // demoC has 18-24 = 0.0
    const filters: DemographicFilter = { c_age: ['18-24'] }
    expect(scoreBackstory(demoC, filters)).toBe(0)
  })

  it('returns 0 when backstory lacks a filtered dimension entirely', () => {
    // demoC has no c_region
    const filters: DemographicFilter = { c_region: ['NE'] }
    expect(scoreBackstory(demoC, filters)).toBe(0)
  })

  it('ignores _sample_size key in filters', () => {
    const filters: DemographicFilter = {
      _sample_size: [10] as unknown as string[],
      c_age: ['18-24'],
    }
    expect(scoreBackstory(demoA, filters)).toBeCloseTo(0.8)
  })

  it('ignores dimensions with empty [] or undefined', () => {
    const filters: DemographicFilter = {
      c_age: [],
      c_gender: undefined,
      c_region: ['NE'],
    }
    // Only c_region matters: 0.7
    expect(scoreBackstory(demoA, filters)).toBeCloseTo(0.7)
  })
})

// ---------- rankAndSelectBackstories ----------

describe('rankAndSelectBackstories', () => {
  it('returns sorted by score descending', () => {
    const filters: DemographicFilter = { c_age: ['18-24'] }
    const result = rankAndSelectBackstories(backstories, filters)

    // demoA: 0.8, demoB: 0.1, demoC: 0.0 (excluded)
    expect(result.length).toBe(2)
    expect(result[0].id).toBe('a')
    expect(result[1].id).toBe('b')
    expect(result[0].score).toBeGreaterThan(result[1].score)
  })

  it('respects topK limit', () => {
    const filters: DemographicFilter = { c_age: ['18-24', '25-34'] }
    const result = rankAndSelectBackstories(backstories, filters, 1)

    expect(result.length).toBe(1)
    expect(result[0].id).toBe('a') // highest score
  })

  it('excludes score-0 backstories', () => {
    const filters: DemographicFilter = { c_age: ['18-24'] }
    const result = rankAndSelectBackstories(backstories, filters)

    // demoC has 18-24 = 0.0, should be excluded
    expect(result.find((r) => r.id === 'c')).toBeUndefined()
  })
})
