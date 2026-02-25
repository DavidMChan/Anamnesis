import { describe, it, expect } from 'vitest'
import { buildDemographicPromptText } from '@/lib/demographicPrompt'

describe('buildDemographicPromptText', () => {
  it('returns "You are a person." for empty filters', () => {
    expect(buildDemographicPromptText({})).toBe('You are a person.')
  })

  it('handles age range with min and max', () => {
    expect(buildDemographicPromptText({ c_age: { min: 29, max: 30 } })).toBe(
      'You are a 29-30 year old.'
    )
  })

  it('handles single gender value', () => {
    expect(buildDemographicPromptText({ c_gender: ['female'] })).toBe('You are a female.')
  })

  it('handles age and gender together', () => {
    expect(
      buildDemographicPromptText({ c_age: { min: 29, max: 30 }, c_gender: ['female'] })
    ).toBe('You are a 29-30 year old female.')
  })

  it('handles age with only min (open-ended upper bound)', () => {
    expect(buildDemographicPromptText({ c_age: { min: 25 } })).toBe('You are a 25+ year old.')
  })

  it('handles multiple gender values joined with "or"', () => {
    expect(buildDemographicPromptText({ c_gender: ['male', 'female'] })).toBe(
      'You are a male or female.'
    )
  })

  it('strips c_ prefix: c_education dimension name is "education"', () => {
    const result = buildDemographicPromptText({ c_education: ['college'] })
    expect(result).toBe('You are a college.')
  })

  it('detects age key by "age" substring in dimension name', () => {
    // c_age_group contains "age" → gets "year old" suffix
    const result = buildDemographicPromptText({ c_age_group: { min: 18, max: 24 } })
    expect(result).toContain('year old')
  })

  it('handles unknown/arbitrary keys gracefully without crashing', () => {
    const result = buildDemographicPromptText({ c_income: ['high'] })
    expect(result).toBe('You are a high.')
  })

  it('handles age with only max', () => {
    expect(buildDemographicPromptText({ c_age: { max: 65 } })).toBe('You are a under 65 year old.')
  })

  it('handles non-age range dimension with min and max', () => {
    const result = buildDemographicPromptText({ c_income: { min: 50000, max: 100000 } })
    expect(result).toBe('You are a 50000-100000 income.')
  })

  it('handles non-age dimension with only min', () => {
    const result = buildDemographicPromptText({ c_income: { min: 50000 } })
    expect(result).toBe('You are a 50000+ income.')
  })

  it('processes keys in sorted order for determinism', () => {
    // c_age < c_gender alphabetically — age descriptor should come before gender
    const result = buildDemographicPromptText({
      c_gender: ['male'],
      c_age: { min: 30, max: 40 },
    })
    const agePos = result.indexOf('30-40')
    const genderPos = result.indexOf('male')
    expect(agePos).toBeLessThan(genderPos)
  })
})
