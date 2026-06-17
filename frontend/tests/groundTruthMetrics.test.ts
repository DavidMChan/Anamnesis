import { describe, it, expect } from 'vitest'
import {
  alignToOptions,
  cronbachAlpha,
  earthMoversDistance,
  frobeniusNorm,
  frobeniusOfCorrelations,
  histogram,
  pearsonCorrelationMatrix,
  toOrdinal,
} from '@/lib/groundTruthMetrics'

describe('toOrdinal', () => {
  it('maps an option to its 1-based index', () => {
    expect(toOrdinal('B', ['A', 'B', 'C'])).toBe(2)
  })
  it('returns NaN for missing, unknown, or multi-select answers', () => {
    expect(toOrdinal(null, ['A', 'B'])).toBeNaN()
    expect(toOrdinal('Z', ['A', 'B'])).toBeNaN()
    expect(toOrdinal(['A', 'B'], ['A', 'B'])).toBeNaN()
  })
})

describe('alignToOptions', () => {
  it('zero-fills unseen options and renormalizes over known options', () => {
    expect(alignToOptions({ A: 0.5, B: 0.5 }, ['A', 'B', 'C'])).toEqual([0.5, 0.5, 0])
    // out-of-option mass is dropped, remainder renormalized
    expect(alignToOptions({ A: 1, Z: 1 }, ['A', 'B'])).toEqual([1, 0])
  })
})

describe('earthMoversDistance', () => {
  it('equals the ordinal shift when all mass moves end to end', () => {
    // all mass on option 1 vs all on option 4 => move distance 3
    expect(earthMoversDistance([1, 0, 0, 0], [0, 0, 0, 1])).toBe(3)
  })
  it('is one notch for a single-step shift', () => {
    expect(earthMoversDistance([1, 0], [0, 1])).toBe(1)
  })
  it('is zero for identical distributions', () => {
    expect(earthMoversDistance([0.2, 0.3, 0.5], [0.2, 0.3, 0.5])).toBe(0)
  })
  it('matches a hand-computed CDF integral', () => {
    // p CDF: 0.5, 1.0 ; q CDF: 0.0, 1.0 ; |diff| over first gap = 0.5
    expect(earthMoversDistance([0.5, 0.5], [0, 1])).toBeCloseTo(0.5, 12)
  })
})

describe('histogram', () => {
  it('builds a normalized count vector over 1..k', () => {
    expect(histogram([1, 1, 2, 3], 3)).toEqual([0.5, 0.25, 0.25])
  })
})

describe('pearsonCorrelationMatrix', () => {
  it('is +1 off-diagonal for perfectly aligned items', () => {
    const corr = pearsonCorrelationMatrix([[1, 1], [2, 2], [3, 3]])
    expect(corr[0][1]).toBeCloseTo(1, 12)
  })
  it('is -1 off-diagonal for perfectly anti-aligned items', () => {
    const corr = pearsonCorrelationMatrix([[1, 3], [2, 2], [3, 1]])
    expect(corr[0][1]).toBeCloseTo(-1, 12)
  })
  it('uses 0 off-diagonal for a zero-variance item (kept finite)', () => {
    const corr = pearsonCorrelationMatrix([[5, 1], [5, 2], [5, 3]])
    expect(corr[0][0]).toBe(1)
    expect(corr[0][1]).toBe(0)
  })
})

describe('frobeniusNorm / frobeniusOfCorrelations', () => {
  it('computes sqrt(sum of squared element differences)', () => {
    // corr(aligned)=[[1,1],[1,1]], corr(anti)=[[1,-1],[-1,1]] => diff off-diag 2 each
    expect(frobeniusNorm([[1, 1], [1, 1]], [[1, -1], [-1, 1]])).toBeCloseTo(Math.sqrt(8), 12)
  })
  it('is zero when both populations share correlation structure', () => {
    const rows = [[1, 1], [2, 2], [3, 3]]
    expect(frobeniusOfCorrelations(rows, rows)).toBeCloseTo(0, 12)
  })
  it('returns null with fewer than two items', () => {
    expect(frobeniusOfCorrelations([[1], [2]], [[1], [2]])).toBeNull()
  })
})

describe('cronbachAlpha', () => {
  it('is 1 for perfectly consistent items', () => {
    // items perfectly correlated: sum item var = 2, total var = 4 => 2*(1-0.5)=1
    expect(cronbachAlpha([[1, 1], [2, 2], [3, 3]])).toBeCloseTo(1, 12)
  })
  it('drops rows with missing answers (listwise) before computing', () => {
    const withGap = [[1, 1], [2, 2], [3, 3], [NaN, 4]]
    expect(cronbachAlpha(withGap)).toBeCloseTo(1, 12)
  })
  it('returns null when undefined (single item or no variance)', () => {
    expect(cronbachAlpha([[1], [2]])).toBeNull()
    expect(cronbachAlpha([[2, 2], [2, 2]])).toBeNull()
  })
})
