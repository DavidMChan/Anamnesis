# Feature: Distribution-Based Demographic Filtering (Two Modes)

## Status
- [ ] Planning complete
- [ ] Ready for implementation

## Description

Replace the current hard-match demographic filtering (which matches on the `value` field) with a **distribution-based** system that offers two selection modes:

1. **Top-K Probability** — Score each backstory by joint probability across selected categories, return the highest-scoring K. Best for studying how the overall population responds. No guarantee of balanced representation across categories.

2. **Balanced Matching (Hungarian)** — Allocate K slots across the cross-product of selected categories, then use the Hungarian algorithm to optimally assign one backstory per slot. Guarantees each selected demographic group is represented. Users can customize the slot allocation.

Both modes use the same underlying data: each backstory's probability distributions per demographic dimension.

---

## UI Design

### Mode Selector

Radio buttons at the top of the demographics section:

```
○ Top-K Probability
  Best for seeing how this group responds overall.
  Selects the K backstories most likely to match your criteria.
  No guarantee of equal representation across selected groups.

● Balanced Matching
  Ensures every selected demographic group is represented.
  Good for comparing responses across subgroups or simulating
  stratified sampling.
```

### Category Selection (same for both modes)

All demographic dimensions show checkboxes for distribution categories (including numeric types like age — show bins like "18-24", "25-34" instead of min/max).

Available categories are discovered from actual backstory data.

### Sample Size (same for both modes)

Free text input. Preview shows pool size and warns if K exceeds available backstories.

### Mode-Specific UI

#### Top-K Mode
No additional UI beyond category checkboxes + sample size.

Preview text:
```
234 backstories scored · top 20 will be selected
```

#### Balanced Matching Mode

After the user selects categories, show the cross-product allocation:

**Default view (uniform distribution):**
```
You selected:
  Age: 18-24, 25-34
  Gender: Male
  Region: Northeast, Midwest
  Sample size: 20

Slots will be distributed evenly across 4 groups.
[Customize slot allocation]
```

**Expanded (after clicking "Customize slot allocation"):**
```
┌─────────────────────────────┬───────┐
│ Group                       │ Slots │
├─────────────────────────────┼───────┤
│ 18-24 · Male · Northeast    │ [ 5 ] │
│ 18-24 · Male · Midwest      │ [ 5 ] │
│ 25-34 · Male · Northeast    │ [ 5 ] │
│ 25-34 · Male · Midwest      │ [ 5 ] │
├─────────────────────────────┼───────┤
│ Total                       │  20   │
└─────────────────────────────┴───────┘
```

- Each input is editable
- Validation: sum must equal sample size K
- Default: `Math.floor(K / numGroups)` with remainder distributed to first groups
- If user changes K, slot allocation resets to uniform (unless customized)

**Preview text (balanced mode):**
```
4 demographic groups · 20 slots allocated
Best available backstory will be matched to each slot.
```

---

## Technical Approach

### Core Concepts

**Backstory demographics** (existing, unchanged):
```json
{
  "c_age": { "value": "18-24", "distribution": { "18-24": 0.6, "25-34": 0.3, "35-44": 0.1 } },
  "c_gender": { "value": "male", "distribution": { "male": 0.7, "female": 0.3 } }
}
```

**Scoring a backstory against a target (one-hot or multi-category):**
```
Per-dimension:  P_d = sum of distribution[cat] for each selected category
Cross-dimension: S  = product of P_d across all dimensions
```

For Top-K mode, the "target" is the user's checkbox selections (multi-category per dimension).
For Balanced mode, each "target slot" is a single combination from the cross-product (one-hot per dimension).

### Mode 1: Top-K Probability

```
1. Fetch all backstories with demographics
2. For each backstory, compute:
   score = Π_d ( Σ_{cat ∈ selected_d} distribution_d[cat] )
3. Sort by score descending
4. Return top K (excluding score = 0)
```

### Mode 2: Balanced Matching (Hungarian)

```
1. Compute cross-product of selected categories
   e.g., {18-24, 25-34} × {male} × {NE, MW} = 4 groups

2. Allocate K slots across groups (uniform or user-customized)
   e.g., [5, 5, 5, 5]

3. Expand slots into target vectors (one-hot per dimension)
   Slot 0: age=[1,0,0,...], gender=[1,0], region=[1,0,0,0]  (18-24, male, NE)
   Slot 1: age=[1,0,0,...], gender=[1,0], region=[1,0,0,0]  (18-24, male, NE)
   ... (5 identical slots for this group)

4. Fetch all backstories with demographics

5. Build cost matrix: K × M
   cost[slot_i][backstory_j] = Π_d ( target_i_d · distribution_j_d )
   (dot product of one-hot target with backstory distribution, per dimension → product)
   This simplifies to: product of distribution[target_category] per dimension

6. Run Hungarian algorithm (maximize total weight)
   scipy.optimize.linear_sum_assignment (Python)
   or munkres/hungarian JS library (frontend)

7. Return assigned backstory IDs
```

**Why identical slots still produce diverse results:**
Hungarian enforces 1-to-1 assignment. With 5 slots for "18-24, male, NE", the algorithm assigns the 5 *different* backstories that best represent that group. The diversity comes from each backstory having a *different* distribution shape even within the same target group.

### Data Shape Changes

**New `DemographicFilter` type** (extends existing):
```typescript
interface DemographicFilter {
  [key: string]: string[] | undefined          // category selections (unchanged)
}

// New: stored alongside demographics in survey_runs
interface DemographicSelectionConfig {
  mode: 'top_k' | 'balanced'
  sample_size: number
  filters: DemographicFilter                    // category checkboxes
  slot_allocation?: Record<string, number>      // balanced mode only
  // Keys are serialized group labels: "18-24|male|NE"
  // Values are slot counts
}
```

The `survey_runs.demographics` column will store `DemographicSelectionConfig` instead of the raw `DemographicFilter`. Old format is backward-compatible (treated as top-K with no sample size).

---

### Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/lib/backstoryScoring.ts` | Scoring functions (shared by both modes) |
| `frontend/src/lib/hungarianMatching.ts` | Hungarian algorithm + slot expansion |
| `frontend/src/lib/__tests__/backstoryScoring.test.ts` | Unit tests for scoring |
| `frontend/src/lib/__tests__/hungarianMatching.test.ts` | Unit tests for matching |
| `worker/src/scoring.py` | Python scoring + Hungarian (mirrors TS) |
| `worker/tests/test_scoring.py` | Python unit tests |

### Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/surveys/DemographicFilter.tsx` | Two-mode UI, cross-product allocation table, distribution key discovery |
| `frontend/src/lib/backstoryFilters.ts` | Replace `applyDemographicFilters` with scoring-based selection |
| `frontend/src/lib/surveyRunner.ts` | Use mode-aware selection (top-K or Hungarian) |
| `frontend/src/types/database.ts` | Add `DemographicSelectionConfig` type, update `DemographicFilter` |
| `worker/src/db.py` | Update `get_backstory_ids_for_survey()` to use scoring/matching |

### Files to Add (Migration)

| File | Purpose |
|------|---------|
| `supabase/migrations/YYYYMMDD_distribution_keys_rpc.sql` | RPC to discover available distribution categories per dimension |

### Key Decisions

- **Product scoring (IID):** Multiply per-dimension probabilities. Same formula for both modes — Top-K uses multi-category targets, Balanced uses one-hot targets.
- **Cross-product slot allocation:** Balanced mode enumerates all combinations. Default is uniform. User can customize.
- **Hungarian in JS:** Use a JS library (e.g., `munkres-js`) for frontend matching. The cost matrix is K×M which is small enough for client-side.
- **Worker mirrors frontend:** Python worker uses `scipy.optimize.linear_sum_assignment`. Must produce identical results.
- **All types become categorical:** Even numeric demographics show distribution-bin checkboxes.

---

## Pass Criteria

### Unit Tests — Scoring (`frontend/src/lib/__tests__/backstoryScoring.test.ts`)

- [ ] `scoreBackstory` returns 1.0 when no filters are active (empty filter)
- [ ] Single dimension, single category: returns that category's probability
- [ ] Single dimension, multiple categories: returns sum of probabilities
- [ ] Multiple dimensions: returns product of per-dimension scores
- [ ] Returns 0 when selected category has zero probability
- [ ] Returns 0 when backstory lacks a filtered dimension entirely
- [ ] Ignores `_sample_size` key in filters
- [ ] Ignores dimensions with empty `[]` or `undefined`
- [ ] `rankAndSelectBackstories` returns sorted by score descending
- [ ] `rankAndSelectBackstories` respects topK limit
- [ ] `rankAndSelectBackstories` excludes score-0 backstories

### Unit Tests — Hungarian Matching (`frontend/src/lib/__tests__/hungarianMatching.test.ts`)

- [ ] `expandSlots` generates correct one-hot target vectors from slot allocation
  - Input: `{ "18-24|male": 2, "25-34|male": 1 }`, dimensions: `[c_age, c_gender]`
  - Output: 3 target vectors with correct one-hot encodings
- [ ] `buildCostMatrix` produces correct K×M matrix
  - Known backstories + known targets → verify specific cell values
- [ ] `hungarianMatch` returns 1-to-1 assignment (no backstory repeated)
- [ ] `hungarianMatch` with uniform slots across 2 groups returns balanced result
  - 2 groups × 5 slots each → 5 backstories per group, no overlap
- [ ] `hungarianMatch` handles K > M gracefully (more slots than backstories)
- [ ] `hungarianMatch` with single group degenerates to top-K behavior
- [ ] `computeCrossProduct` correctly enumerates combinations
  - `{c_age: ["18-24","25-34"], c_gender: ["male"]}` → 2 groups
  - `{c_age: ["18-24","25-34"], c_region: ["NE","MW"]}` → 4 groups
- [ ] `uniformSlotAllocation` distributes K slots evenly with remainder
  - K=10, 3 groups → [4, 3, 3]
  - K=10, 4 groups → [3, 3, 2, 2]

### Unit Tests — Python (`worker/tests/test_scoring.py`)

- [ ] Python `score_backstory` matches TypeScript for identical inputs
- [ ] Python Hungarian matching produces identical assignments to TypeScript for identical inputs
- [ ] Worker `get_backstory_ids_for_survey` handles both modes correctly

### E2E Tests

- [ ] User switches between Top-K and Balanced mode; UI updates accordingly
- [ ] Top-K mode: select age 18-24, set K=10, run → 10 tasks created
- [ ] Balanced mode: select age [18-24, 25-34], gender [male], K=10 → shows 2 groups with 5 slots each
- [ ] Balanced mode: click "Customize slot allocation" → editable inputs appear
- [ ] Balanced mode: change slot counts → validation enforces sum = K
- [ ] Balanced mode: run survey → tasks created match slot allocation
- [ ] Numeric demographics (age, income) show checkbox bins, not min/max

### Acceptance Criteria

- [ ] Two-mode radio selector visible in demographics section
- [ ] Mode descriptions clearly explain the difference
- [ ] All demographic types show distribution-bin checkboxes
- [ ] Available bins discovered from actual backstory data
- [ ] Top-K mode: preview shows "X backstories scored, top K selected"
- [ ] Balanced mode: shows cross-product groups with default uniform allocation
- [ ] Balanced mode: "Customize slot allocation" expands editable table
- [ ] Balanced mode: slot sum validation (must equal K)
- [ ] Survey run snapshot records mode + allocation in `survey_runs.demographics`
- [ ] Worker and frontend produce identical selections for same inputs
- [ ] Backward compatibility: old surveys with value-match filters still work
- [ ] Zero-score backstories excluded in both modes

---

## Implementation Notes

### For the Implementing Agent

**Order:**
1. `backstoryScoring.ts` + tests — pure scoring functions, both modes depend on this
2. `hungarianMatching.ts` + tests — slot expansion, cost matrix, Hungarian wrapper
3. `DemographicFilter.tsx` — two-mode UI with cross-product table
4. `surveyRunner.ts` — mode-aware backstory selection
5. `backstoryFilters.ts` — update or replace `applyDemographicFilters`
6. `worker/src/scoring.py` + `db.py` — Python equivalents
7. Supabase migration for distribution key discovery RPC

### JS Hungarian Algorithm

Use `munkres-js` (npm package) or implement a simple version. The algorithm needs to:
- Accept a K×M cost matrix (K ≤ M)
- Return K assignments maximizing total cost
- `scipy.optimize.linear_sum_assignment` minimizes, so negate weights for maximization. Same for JS.

### Cross-Product Computation

```typescript
function computeCrossProduct(filters: DemographicFilter): string[][] {
  // filters = { c_age: ["18-24", "25-34"], c_gender: ["male"], c_region: ["NE", "MW"] }
  // Returns: [
  //   ["18-24", "male", "NE"],
  //   ["18-24", "male", "MW"],
  //   ["25-34", "male", "NE"],
  //   ["25-34", "male", "MW"],
  // ]
}
```

Be careful with large cross-products. If user selects 4 age bins × 2 genders × 4 regions × 3 parties = 96 groups. With K=100, that's ~1 slot per group. Show a warning if numGroups > K.

### Slot Allocation Serialization

Use a pipe-delimited key for the cross-product group:
```json
{
  "18-24|male|NE": 5,
  "18-24|male|MW": 5,
  "25-34|male|NE": 5,
  "25-34|male|MW": 5
}
```

Store the dimension order alongside so it can be parsed back.

### Reference Patterns

- Anthology matching: `anthology/scripts/run_demographic_matching.py` (edge_weight_calculation, maximum_weight_sum_matching)
- Alterity matching: `alterity-private-main/alterity/preprocess/survey_data_generator.py` (SurveyDataGenerator)
- Current filter UI: `frontend/src/components/surveys/DemographicFilter.tsx`
- Current filter logic: `frontend/src/lib/backstoryFilters.ts`
- Worker filtering: `worker/src/db.py:316-385`

### Gotchas

- **`_sample_size` key**: Skip in scoring. In new config, sample size lives in `DemographicSelectionConfig.sample_size` instead.
- **Custom filters** (`custom_*`): No distributions. Keep exact-match behavior. Excluded from cross-product in balanced mode.
- **Anthology backstories**: Excluded (no demographics). Keep `.neq('source_type', 'anthology')`.
- **Missing dimensions**: Score = 0 for that backstory → excluded.
- **Cross-product explosion**: Warn if numGroups > K ("Not enough sample size for all groups"). Minimum 1 slot per group.
- **Hungarian with K > M**: More slots than backstories. Fall back to assigning each backstory to its best slot, leaving some slots empty. Show warning.
- **Backward compatibility**: Old `DemographicFilter` (no mode field) → treat as top-K with no sample limit.

### Test Data

```typescript
const backstories = [
  {
    id: "a",
    demographics: {
      c_age: { value: "18-24", distribution: { "18-24": 0.8, "25-34": 0.15, "35-44": 0.05 } },
      c_gender: { value: "male", distribution: { "male": 0.9, "female": 0.1 } },
      c_region: { value: "NE", distribution: { "NE": 0.7, "MW": 0.2, "S": 0.05, "W": 0.05 } }
    }
  },
  {
    id: "b",
    demographics: {
      c_age: { value: "25-34", distribution: { "18-24": 0.1, "25-34": 0.7, "35-44": 0.2 } },
      c_gender: { value: "male", distribution: { "male": 0.8, "female": 0.2 } },
      c_region: { value: "MW", distribution: { "NE": 0.1, "MW": 0.6, "S": 0.2, "W": 0.1 } }
    }
  },
  // ... more with known distributions for deterministic assertions
]
```

---

## Out of Scope

- User-configurable dimension weights (equal weight via product for now)
- Probabilistic/random sampling (deterministic only)
- Uploading real human survey data for matching (future feature)
- Changes to backstory upload/generation
- Changes to results/analysis page
- Per-backstory score visualization in UI (e.g., score histograms)
