---
name: code-review
description: Review all code changes in a feature worktree against its CRITERIA.md spec.
argument-hint: <feature-name>
---

# Code Review

You are a senior code reviewer. Review all changes in the feature worktree thoroughly, checking against CRITERIA.md and general code quality standards.

## CRITICAL RULES

1. **Read CRITERIA.md first** - Understand what was supposed to be built
2. **Review ALL changed files** - Don't skip any
3. **Be specific** - Reference exact file paths and line numbers
4. **Categorize findings** - Distinguish blocking issues from suggestions

## Steps

### Step 0: Find Feature Worktree

The argument `$ARGUMENTS` could be:
- Just the feature name: `ui-overhaul`
- With prefix: `arena-feature-ui-overhaul`
- Or the branch name: `feature/ui-overhaul`

**Normalize the feature name:**
```bash
FEATURE_NAME="$ARGUMENTS"
FEATURE_NAME="${FEATURE_NAME#arena-feature-}"
FEATURE_NAME="${FEATURE_NAME#feature/}"
```

```bash
git worktree list
```

Get the absolute path for the worktree from the output.

If no worktree found for the feature, ERROR and stop.

### Step 1: Read CRITERIA.md

```bash
cat /absolute/path/to/arena-feature-${FEATURE_NAME}/CRITERIA.md
```

Note all pass criteria and acceptance criteria checkboxes — you will verify each one.

If no CRITERIA.md exists, note this and proceed with a general code quality review only.

### Step 2: Get the Full Diff

```bash
cd /absolute/path/to/arena-feature-${FEATURE_NAME} && git diff main...HEAD
```

Also check for untracked/unstaged files:
```bash
cd /absolute/path/to/arena-feature-${FEATURE_NAME} && git status
```

If there are unstaged changes, flag them in the review.

### Step 3: List All Changed Files

```bash
cd /absolute/path/to/arena-feature-${FEATURE_NAME} && git diff main...HEAD --name-status
```

### Step 4: Read and Review Each Changed File

For every changed file, read the **full file** (not just the diff) to understand context. Use the Read tool for this.

Review each file for:

#### Correctness
- Does the logic do what CRITERIA.md specifies?
- Are there off-by-one errors, race conditions, or null/undefined risks?
- Are error cases handled?

#### Security
- No hardcoded secrets, tokens, or credentials
- No SQL injection, XSS, or command injection vectors
- Proper input validation at system boundaries
- No sensitive data in logs

#### Code Quality
- Follows existing codebase patterns and conventions
- No dead code, unused imports, or commented-out code left behind
- Variable/function names are clear and consistent
- No unnecessary complexity or over-engineering

#### TypeScript/React Specific (frontend)
- Proper typing (no unnecessary `any`)
- React hooks follow rules of hooks
- No missing dependency arrays in useEffect/useMemo/useCallback
- Components are reasonably sized

#### Python Specific (worker)
- Type hints where the codebase uses them
- Proper exception handling
- No bare `except:` clauses
- Resource cleanup (connections, files)

#### Tests
- Are tests present for new functionality?
- Do tests cover the pass criteria from CRITERIA.md?
- Are edge cases tested?
- Are tests isolated (no shared mutable state)?

### Step 5: Verify CRITERIA.md Pass Criteria

Go through each checkbox in CRITERIA.md and determine:
- **Met**: The implementation clearly satisfies this criterion
- **Partially met**: Some aspects are covered but gaps remain
- **Not met**: This criterion is not addressed
- **Cannot verify**: Needs manual testing or environment access

### Step 6: Report Review Results

Format the review as:

```
CODE REVIEW: ${FEATURE_NAME}
Worktree: /absolute/path/to/arena-feature-${FEATURE_NAME}
Branch: feature/${FEATURE_NAME}
Files changed: N

═══════════════════════════════════════
CRITERIA VERIFICATION
═══════════════════════════════════════

### Pass Criteria
- [x] Criterion 1 — Met. [brief explanation]
- [~] Criterion 2 — Partially met. [what's missing]
- [ ] Criterion 3 — Not met. [explanation]

### Acceptance Criteria
- [x] Criterion A — Met.
- [ ] Criterion B — Not met. [explanation]

═══════════════════════════════════════
BLOCKING ISSUES (must fix before merge)
═══════════════════════════════════════

1. **[file:line]** — [Description of the issue]
   Why: [Why this is blocking]
   Suggestion: [How to fix]

2. ...

═══════════════════════════════════════
WARNINGS (should fix)
═══════════════════════════════════════

1. **[file:line]** — [Description]
   Suggestion: [How to fix]

═══════════════════════════════════════
SUGGESTIONS (nice to have)
═══════════════════════════════════════

1. **[file:line]** — [Description]

═══════════════════════════════════════
VERDICT
═══════════════════════════════════════

[One of:]
- ✅ APPROVE — All criteria met, no blocking issues. Ready for /pr
- ⚠️ APPROVE WITH WARNINGS — All criteria met, minor issues noted. Can proceed with /pr
- 🔄 REQUEST CHANGES — Blocking issues or unmet criteria found. Fix then re-run /refactor → /code-review.
```

## Notes

- Be thorough but pragmatic. Don't nitpick formatting when there are real issues.
- Focus on what matters: correctness, security, and criteria satisfaction.
- If you see patterns of the same issue, mention it once and note it applies to multiple files.
- Do NOT make any changes to the code. This is review only.
