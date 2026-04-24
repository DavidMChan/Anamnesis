import type { Question, SurveyResults as SurveyResultsType } from '@/types/database'

const EPS = 1e-12

export interface CredibleInterval {
  lower: number
  upper: number
}

export interface DistributionDatum {
  option: string
  count: number
  percentageExact: number
  percentage: number
  ciLower: number
  ciUpper: number
  errorRange?: [number, number]
}

export interface RankingStabilityState {
  counts: number[]
  beta: number[]
  posteriorMeans: number[]
  ranking: number[]
  adjacentProbabilities: number[]
  errorBound: number
  confidenceLowerBound: number
  shouldStop: boolean
}

export interface AdaptiveSamplingSummary {
  eligibleQuestions: number
  sampleCount: number
  epsilon: number
  minSamples: number
  confidenceLowerBound: number
  shouldStop: boolean
  questionStates: Record<string, RankingStabilityState>
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b)
}

function logGamma(z: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ]

  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z)
  }

  let x = 0.9999999999998099
  const shifted = z - 1
  for (let i = 0; i < coefficients.length; i += 1) {
    x += coefficients[i] / (shifted + i + 1)
  }
  const t = shifted + coefficients.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x)
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIterations = 200
  const fpMin = 1e-30
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < fpMin) d = fpMin
  d = 1 / d
  let h = d

  for (let m = 1; m <= maxIterations; m += 1) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < fpMin) d = fpMin
    c = 1 + aa / c
    if (Math.abs(c) < fpMin) c = fpMin
    d = 1 / d
    h *= d * c

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < fpMin) d = fpMin
    c = 1 + aa / c
    if (Math.abs(c) < fpMin) c = fpMin
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 3e-14) break
  }

  return h
}

export function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - logBeta(a, b))
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaContinuedFraction(a, b, x)) / a
  }
  return 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b
}

function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0
  if (p >= 1) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2
    if (regularizedIncompleteBeta(a, b, mid) < p) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export function betaCredibleInterval(successes: number, failures: number, level = 0.95): CredibleInterval {
  const tail = (1 - level) / 2
  const a = 1 + successes
  const b = 1 + failures
  return {
    lower: betaQuantile(tail, a, b),
    upper: betaQuantile(1 - tail, a, b),
  }
}

export function pairwiseProbGreater(a: number, b: number): number {
  return 1 - regularizedIncompleteBeta(a, b, 0.5)
}

export function computeRankingStability(
  counts: number[],
  epsilon: number,
): RankingStabilityState {
  const beta = counts.map((count) => count + 1)
  const total = beta.reduce((sum, value) => sum + value, 0)
  const posteriorMeans = beta.map((value) => value / total)
  const ranking = posteriorMeans
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .map((item) => item.index)

  const adjacentProbabilities: number[] = []
  for (let i = 0; i < ranking.length - 1; i += 1) {
    adjacentProbabilities.push(pairwiseProbGreater(beta[ranking[i]], beta[ranking[i + 1]]))
  }

  const errorBound = adjacentProbabilities.reduce((sum, q) => sum + (1 - q), 0)
  const confidenceLowerBound = Math.max(0, 1 - errorBound)

  return {
    counts,
    beta,
    posteriorMeans,
    ranking,
    adjacentProbabilities,
    errorBound,
    confidenceLowerBound,
    shouldStop: errorBound < epsilon,
  }
}

export function letterToOption(letter: string, options: string[] | undefined): string | null {
  if (!options) return null
  const index = letter.trim().toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0)
  if (index >= 0 && index < options.length) return options[index]
  return null
}

export function computeDistributionWithIntervals(
  counts: Record<string, number>,
  totalWeight: number,
  includeIntervals = true,
): DistributionDatum[] {
  return Object.entries(counts).map(([option, count]) => {
    const failures = Math.max(0, totalWeight - count)
    const percentageExact = totalWeight > 0 ? (count / totalWeight) * 100 : 0
    const ci = includeIntervals ? betaCredibleInterval(count, failures) : null
    const ciLower = ci ? Math.max(0, Math.round((ci.lower * 100 + EPS) * 10) / 10) : 0
    const ciUpper = ci ? Math.min(100, Math.round((ci.upper * 100 + EPS) * 10) / 10) : 0
    return {
      option,
      count: Math.round(count * 10) / 10,
      percentageExact,
      percentage: Math.round(percentageExact),
      ciLower,
      ciUpper,
      errorRange: ci
        ? [Math.max(0, percentageExact - ciLower), Math.max(0, ciUpper - percentageExact)]
        : undefined,
    }
  })
}

export function computeAdaptiveSamplingSummary(
  questions: Question[],
  results: SurveyResultsType,
  options: { epsilon: number; minSamples: number },
): AdaptiveSamplingSummary | null {
  const questionStates: Record<string, RankingStabilityState> = {}
  const sampleCount = Object.keys(results).length

  for (const question of questions) {
    if (question.type !== 'mcq' || !question.options || question.options.length < 2) continue

    const counts = Array.from({ length: question.options.length }, () => 0)
    for (const response of Object.values(results)) {
      const answer = response[question.qkey]
      if (typeof answer !== 'string') continue
      const index = answer.trim().toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0)
      if (index >= 0 && index < counts.length) counts[index] += 1
    }

    questionStates[question.qkey] = computeRankingStability(counts, options.epsilon)
  }

  const states = Object.values(questionStates)
  if (states.length === 0) return null

  const confidenceLowerBound = Math.min(...states.map((state) => state.confidenceLowerBound))
  return {
    eligibleQuestions: states.length,
    sampleCount,
    epsilon: options.epsilon,
    minSamples: options.minSamples,
    confidenceLowerBound,
    shouldStop: sampleCount >= options.minSamples && states.every((state) => state.shouldStop),
    questionStates,
  }
}
