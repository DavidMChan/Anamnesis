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

### Step 0: Locate Feature Worktree

If `$ARGUMENTS` is provided, the feature is in a worktree:

```bash
# Verify worktree exists
ls ../arena-feature-$ARGUMENTS 2>/dev/null && echo "Worktree found" || echo "Not found"
```

If worktree exists, all commands should use the worktree path: `../arena-feature-$ARGUMENTS`

If no argument provided, work in current directory.

### Step 1: Check Current Branch

```bash
# If using worktree:
cd ../arena-feature-$ARGUMENTS && git branch --show-current

# If no worktree:
git branch --show-current
```

- If on `main`: ERROR - "Cannot create PR from main branch"

### Step 2: Run ALL Tests

Run from the worktree (or current directory):

```bash
# Frontend unit tests
cd ../arena-feature-$ARGUMENTS/frontend && npm run test:run

# Worker tests
cd ../arena-feature-$ARGUMENTS/worker && python -m pytest

# E2E tests
cd ../arena-feature-$ARGUMENTS/frontend && npm run test:e2e
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
cat ../arena-feature-$ARGUMENTS/CRITERIA.md 2>/dev/null || echo "No CRITERIA.md found"
```

### Step 4: Push Branch

```bash
cd ../arena-feature-$ARGUMENTS && git push -u origin $(git branch --show-current)
```

### Step 5: Create PR

Using gh cli:
- Title: branch name (e.g., "feature/login")
- Body: Contents of CRITERIA.md if exists, otherwise default template

```bash
cd ../arena-feature-$ARGUMENTS && gh pr create --title "$(git branch --show-current)" --body-file CRITERIA.md
```

If no CRITERIA.md, use:
```bash
cd ../arena-feature-$ARGUMENTS && gh pr create --title "$(git branch --show-current)" --body "$(cat <<'EOF'
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
