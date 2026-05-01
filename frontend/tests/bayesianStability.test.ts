import { describe, expect, it } from 'vitest'
import {
  computeDistributionWithIntervals,
  computeRankingStability,
  pairwiseProbGreater,
  regularizedIncompleteBeta,
} from '@/lib/bayesianStability'

describe('bayesianStability', () => {
  it('computes known symmetric beta values', () => {
    expect(regularizedIncompleteBeta(2, 2, 0.5)).toBeCloseTo(0.5, 10)
    expect(pairwiseProbGreater(4, 4)).toBeCloseTo(0.5, 10)
  })

  it('stops for a clearly separated ranking', () => {
    const state = computeRankingStability([1, 100], 0.05)

    expect(state.ranking).toEqual([1, 0])
    expect(state.shouldStop).toBe(true)
    expect(state.confidenceLowerBound).toBeGreaterThan(0.95)
  })

  it('can suppress intervals for weighted filtered distributions', () => {
    const distribution = computeDistributionWithIntervals({ A: 1.5, B: 0.5 }, 2, false)

    expect(distribution[0].errorRange).toBeUndefined()
    expect(distribution[1].errorRange).toBeUndefined()
  })
})
