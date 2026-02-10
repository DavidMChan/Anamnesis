---
name: pr
description: Create a pull request. ONLY proceeds if ALL tests pass.
argument-hint: <feature-name>
---

# Create Pull Request

## CRITICAL RULES

1. **MUST run ALL tests first** - Never skip this step
2. **If ANY test fails**: STOP immediately, do NOT create PR
3. **Only create PR when all tests pass**

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
# List worktrees to find the absolute path
git worktree list
```

Get the absolute path for the worktree from the output (e.g., `/Users/name/arena-feature-ui-overhaul`).

If no worktree found for the feature, work in current directory (for non-worktree PRs).

### Step 1: Check Current Branch

```bash
# Use absolute path from worktree list
cd /absolute/path/to/arena-feature-${FEATURE_NAME} && git branch --show-current
```

- If on `main`: ERROR - "Cannot create PR from main branch"

### Step 2: Run ALL Tests

Run from the worktree using absolute path:

```bash
# Frontend unit tests
cd /absolute/path/to/arena-feature-${FEATURE_NAME}/frontend && npm run test:run

# Worker tests (if exists)
cd /absolute/path/to/arena-feature-${FEATURE_NAME}/worker && python -m pytest 2>/dev/null || echo "No worker tests"

# E2E tests
cd /absolute/path/to/arena-feature-${FEATURE_NAME}/frontend && npm run test:e2e
```

**If ANY test fails**:
```
CANNOT CREATE PR

Tests are failing. Please fix the following issues:
[Show error details]

Run /test to see full results.
```
**STOP HERE. Do not proceed.**

### Step 3: Check for CRITERIA.md

```bash
cat /absolute/path/to/arena-feature-${FEATURE_NAME}/CRITERIA.md 2>/dev/null || echo "No CRITERIA.md found"
```

### Step 4: Push Branch

```bash
cd /absolute/path/to/arena-feature-${FEATURE_NAME} && git push -u origin $(git branch --show-current)
```

### Step 5: Create PR

Using gh cli from the worktree directory:

```bash
cd /absolute/path/to/arena-feature-${FEATURE_NAME} && gh pr create --title "$(git branch --show-current)" --body-file CRITERIA.md
```

If no CRITERIA.md, use:
```bash
cd /absolute/path/to/arena-feature-${FEATURE_NAME} && gh pr create --title "$(git branch --show-current)" --body "$(cat <<'EOF'
## Summary

[Description of changes]

## Test Plan

- [x] Unit tests pass
- [x] E2E tests pass

---
Generated with Claude Code
EOF
)"
```

### Step 6: Report PR URL

Tell the user the PR URL so they can review it.

## Do NOT merge - the user will have another agent review it first.
