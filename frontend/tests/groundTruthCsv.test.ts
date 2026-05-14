import { describe, it, expect } from 'vitest'
import { parseGroundTruthCsv, validRespondents } from '@/lib/groundTruthCsv'
import type { Question } from '@/types/database'

const knownDemographicKeys = new Set(['c_age', 'c_gender', 'c_region'])

const surveyQuestions: Question[] = [
  { qkey: '1', type: 'mcq', text: 'Q1', options: ['A', 'B', 'C'] },
  { qkey: '2', type: 'open_response', text: 'Q2' },
  { qkey: '3', type: 'multiple_select', text: 'Q3', options: ['X', 'Y', 'Z'] },
]

describe('parseGroundTruthCsv', () => {
  it('parses per-respondent mode with demographics and answers', () => {
    const csv = [
      '_id,c_age,c_gender,c_region,q1,q2',
      'r1,25-34,male,NE,A,Some text',
      'r2,18-24,female,MW,B,Other',
    ].join('\n')

    const result = parseGroundTruthCsv({
      csvText: csv,
      knownDemographicKeys,
      surveyQuestions,
    })

    expect(result.fatalError).toBeNull()
    expect(result.mode).toBe('per_respondent')
    expect(result.demographicKeys.sort()).toEqual(['c_age', 'c_gender', 'c_region'])
    expect(result.questionKeys.sort()).toEqual(['1', '2'])
    expect(result.stats.validRows).toBe(2)
    expect(result.stats.errorRows).toBe(0)

    const respondents = validRespondents(result)
    expect(respondents[0]._id).toBe('r1')
    expect(respondents[0].demographics).toEqual({ c_age: '25-34', c_gender: 'male', c_region: 'NE' })
    expect(respondents[0].answers).toEqual({ '1': 'A', '2': 'Some text' })
    expect(respondents[0]._count).toBeUndefined()
  })

  it('flips to aggregate mode when _count column is present', () => {
    const csv = [
      '_id,_count,c_age,c_gender',
      'grp1,50,25-34,male',
      'grp2,30,18-24,female',
    ].join('\n')

    const result = parseGroundTruthCsv({
      csvText: csv,
      knownDemographicKeys,
      surveyQuestions,
    })

    expect(result.mode).toBe('aggregate')
    const respondents = validRespondents(result)
    expect(respondents[0]._count).toBe(50)
    expect(respondents[1]._count).toBe(30)
    expect(result.stats.totalRespondents).toBe(80)
  })

  it('drops refused / empty demographic values from target vector', () => {
    const csv = [
      '_id,c_age,c_gender,c_region',
      'r1,25-34,Refused,NE',
      'r2,,male,MW',
      'r3,18-24,female,n/a',
    ].join('\n')

    const result = parseGroundTruthCsv({
      csvText: csv,
      knownDemographicKeys,
      surveyQuestions,
    })

    const respondents = validRespondents(result)
    expect(respondents[0].demographics).toEqual({ c_age: '25-34', c_region: 'NE' })
    expect(respondents[1].demographics).toEqual({ c_gender: 'male', c_region: 'MW' })
    expect(respondents[2].demographics).toEqual({ c_age: '18-24', c_gender: 'female' })
    expect(result.stats.droppedDimensions).toEqual({ c_age: 1, c_gender: 1, c_region: 1 })
  })

  it('errors a row when all demographics are refused', () => {
    const csv = [
      '_id,c_age,c_gender',
      'r1,Refused,n/a',
    ].join('\n')

    const result = parseGroundTruthCsv({
      csvText: csv,
      knownDemographicKeys,
      surveyQuestions,
    })

    expect(result.stats.errorRows).toBe(1)
    expect(result.stats.validRows).toBe(0)
    expect(result.rows[0].respondent).toBeNull()
    expect(result.rows[0].issues[0].level).toBe('error')
  })

  it('treats unknown column headers as warnings (collected, not used)', () => {
    const csv = [
      '_id,c_age,marital_status,c_gender',
      'r1,25-34,married,male',
    ].join('\n')

    const result = parseGroundTruthCsv({
      csvText: csv,
      knownDemographicKeys,
      surveyQuestions,
    })

    expect(result.unknownHeaders).toEqual(['marital_status'])
    expect(result.demographicKeys.sort()).toEqual(['c_age', 'c_gender'])
    const respondents = validRespondents(result)
    expect(respondents[0].demographics).toEqual({ c_age: '25-34', c_gender: 'male' })
  })

  it('parses multi-select answers split on | or ;', () => {
    const csv = [
      '_id,c_age,q3',
      'r1,25-34,X|Y',
      'r2,18-24,Y;Z',
    ].join('\n')

    const result = parseGroundTruthCsv({
      csvText: csv,
      knownDemographicKeys,
      surveyQuestions,
    })

    const respondents = validRespondents(result)
    expect(respondents[0].answers).toEqual({ '3': ['X', 'Y'] })
    expect(respondents[1].answers).toEqual({ '3': ['Y', 'Z'] })
  })

  it('errors when no demographic columns are recognized', () => {
    const csv = [
      '_id,foo,bar',
      'r1,1,2',
    ].join('\n')

    const result = parseGroundTruthCsv({
      csvText: csv,
      knownDemographicKeys,
      surveyQuestions,
    })

    expect(result.fatalError).not.toBeNull()
    expect(result.fatalError).toContain('demographic')
  })

  it('errors invalid _count values', () => {
    const csv = [
      '_id,_count,c_age',
      'r1,abc,25-34',
      'r2,-5,18-24',
      'r3,10,35-44',
    ].join('\n')

    const result = parseGroundTruthCsv({
      csvText: csv,
      knownDemographicKeys,
      surveyQuestions,
    })

    expect(result.stats.errorRows).toBe(2)
    expect(result.stats.validRows).toBe(1)
    expect(result.stats.totalRespondents).toBe(10)
  })

  it('falls back to row_N when _id column is missing', () => {
    const csv = [
      'c_age,c_gender',
      '25-34,male',
      '18-24,female',
    ].join('\n')

    const result = parseGroundTruthCsv({
      csvText: csv,
      knownDemographicKeys,
      surveyQuestions,
    })

    const respondents = validRespondents(result)
    expect(respondents[0]._id).toBe('row_1')
    expect(respondents[1]._id).toBe('row_2')
  })
})
