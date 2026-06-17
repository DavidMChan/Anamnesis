/**
 * Distribution-alignment metrics for the Ground Truth tab.
 *
 * These mirror the three metrics the Anthology paper reports in Table 1
 * (`anthology/anthology/analysis/atp.py`), so an anamnesis Ground Truth run is
 * scored the *same way* the paper scores virtual-vs-human populations:
 *
 *   - WD  (Wasserstein / Earth Mover's Distance, averaged over questions) —
 *         per-question marginal "shape" distance. Anthology default
 *         `dist_type="EMD"` via `scipy.stats.wasserstein_distance`. Lower better.
 *   - Fro (Frobenius norm of the difference of correlation matrices) —
 *         cross-question structure. Anthology `cov_matrix_distance(..., "Frobenius")`
 *         on the correlation (not covariance) matrices. Lower better.
 *   - alpha (Cronbach's alpha) — internal consistency of a single population.
 *         Reported per population; the LLM's alpha is read against the human's.
 *
 * All inputs are ordinal: an MCQ answer is mapped to its option index (1..K),
 * matching anthology's Likert encoding. Non-MCQ answers and refusals become NaN.
 *
 * Deviations from the paper (documented so numbers stay explainable):
 *   - No survey weights. Anthology weights humans by ATP survey weights; the
 *     ground-truth CSV carries none, so every subject counts equally.
 *   - Fro/alpha use listwise deletion (a subject row is dropped if it is missing
 *     any MCQ answer), matching anthology's `~np.isnan(X).any(axis=1)` mask.
 *   - A question with zero variance contributes 0 off-diagonal correlation
 *     (instead of NaN) so Fro stays finite.
 */

/** Map an MCQ answer to its 1-based option index, or NaN if absent/invalid. */
export function toOrdinal(
  answer: string | string[] | null | undefined,
  options: string[],
): number {
  if (answer === null || answer === undefined || Array.isArray(answer)) return NaN
  const idx = options.indexOf(answer)
  return idx >= 0 ? idx + 1 : NaN
}

/**
 * Align a {category: probability} map to the question's option order,
 * zero-filling unseen options and renormalizing over the known options
 * (drops out-of-option mass). Matches anthology's reindex+fill_value=0.
 */
export function alignToOptions(
  distribution: Record<string, number>,
  options: string[],
): number[] {
  const vec = options.map((opt) => distribution[opt] ?? 0)
  const total = vec.reduce((s, v) => s + v, 0)
  if (total <= 0) return vec
  return vec.map((v) => v / total)
}

/** Normalized count vector (length k) for a list of 1..k ordinal values. */
export function histogram(values: number[], k: number): number[] {
  const counts = new Array(k).fill(0)
  for (const v of values) {
    const idx = v - 1
    if (idx >= 0 && idx < k) counts[idx] += 1
  }
  const total = values.length
  return total > 0 ? counts.map((c) => c / total) : counts
}

/**
 * Earth Mover's Distance (Wasserstein-1) between two distributions over an
 * ordered, unit-spaced support (the option index). Equivalent to
 * `scipy.stats.wasserstein_distance([1..K], [1..K], p, q)`: in 1-D with unit
 * spacing this is the sum of absolute CDF differences across the support.
 */
export function earthMoversDistance(p: number[], q: number[]): number {
  if (p.length !== q.length) {
    throw new Error('earthMoversDistance: vectors must have equal length')
  }
  let cumP = 0
  let cumQ = 0
  let emd = 0
  for (let i = 0; i < p.length - 1; i++) {
    cumP += p[i]
    cumQ += q[i]
    emd += Math.abs(cumP - cumQ)
  }
  return emd
}

/**
 * Pearson correlation matrix (k x k) over subjects x items. Rows missing any
 * item (NaN) are dropped listwise. Degenerate (zero-variance) items get a
 * unit diagonal and zero off-diagonal so downstream Frobenius stays finite.
 * The n vs n-1 normalization cancels in a correlation, so it is irrelevant.
 */
export function pearsonCorrelationMatrix(rows: number[][]): number[][] {
  const k = rows[0]?.length ?? 0
  if (k === 0) return []
  const complete = rows.filter(
    (r) => r.length === k && r.every((v) => Number.isFinite(v)),
  )
  const corr: number[][] = Array.from({ length: k }, () => new Array(k).fill(0))
  const n = complete.length
  if (n < 2) {
    for (let i = 0; i < k; i++) corr[i][i] = 1
    return corr
  }

  const mean = new Array(k).fill(0)
  for (const r of complete) for (let j = 0; j < k; j++) mean[j] += r[j]
  for (let j = 0; j < k; j++) mean[j] /= n

  const std = new Array(k).fill(0)
  for (const r of complete)
    for (let j = 0; j < k; j++) {
      const d = r[j] - mean[j]
      std[j] += d * d
    }
  for (let j = 0; j < k; j++) std[j] = Math.sqrt(std[j] / n)

  for (let i = 0; i < k; i++) {
    corr[i][i] = 1
    for (let j = i + 1; j < k; j++) {
      if (std[i] === 0 || std[j] === 0) {
        corr[i][j] = corr[j][i] = 0
        continue
      }
      let cov = 0
      for (const r of complete) cov += (r[i] - mean[i]) * (r[j] - mean[j])
      cov /= n
      const c = cov / (std[i] * std[j])
      corr[i][j] = corr[j][i] = c
    }
  }
  return corr
}

/** Frobenius norm of the element-wise difference of two equal-shape matrices. */
export function frobeniusNorm(a: number[][], b: number[][]): number {
  let s = 0
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < a[i].length; j++) {
      const d = a[i][j] - b[i][j]
      s += d * d
    }
  return Math.sqrt(s)
}

/**
 * Frobenius distance between the correlation matrices of two populations
 * (subjects x items). Null when there are fewer than 2 items.
 */
export function frobeniusOfCorrelations(
  humanRows: number[][],
  llmRows: number[][],
): number | null {
  const k = humanRows[0]?.length ?? 0
  if (k < 2) return null
  return frobeniusNorm(
    pearsonCorrelationMatrix(humanRows),
    pearsonCorrelationMatrix(llmRows),
  )
}

/**
 * Cronbach's alpha = k/(k-1) * (1 - sum(item var) / total-score var), over
 * subjects x items with listwise deletion. Null when undefined (< 2 items,
 * < 2 complete subjects, or zero total-score variance). Sample variance is
 * used throughout; the n-1 factor cancels in the ratio.
 */
export function cronbachAlpha(rows: number[][]): number | null {
  const k = rows[0]?.length ?? 0
  if (k < 2) return null
  const complete = rows.filter(
    (r) => r.length === k && r.every((v) => Number.isFinite(v)),
  )
  const n = complete.length
  if (n < 2) return null

  const variance = (xs: number[]): number => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1)
  }

  let sumItemVar = 0
  for (let j = 0; j < k; j++) sumItemVar += variance(complete.map((r) => r[j]))
  const totalVar = variance(complete.map((r) => r.reduce((a, b) => a + b, 0)))
  if (totalVar === 0) return null

  return (k / (k - 1)) * (1 - sumItemVar / totalVar)
}
