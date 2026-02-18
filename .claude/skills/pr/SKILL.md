---
name: pr
description: Create a pull request from a feature worktree.
argument-hint: <feature-name>
---

# Create Pull Request

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

### Step 2: Check for CRITERIA.md

```bash
cat /absolute/path/to/arena-feature-${FEATURE_NAME}/CRITERIA.md 2>/dev/null || echo "No CRITERIA.md found"
```

### Step 3: Push Branch

```bash
cd /absolute/path/to/arena-feature-${FEATURE_NAME} && git push -u origin $(git branch --show-current)
```

### Step 4: Create PR

Using gh cli from the worktree directory:

```bash
cd /absolute/path/to/arena-feature-${FEATURE_NAME} && gh pr create --title "$(git branch --show-current)" --body-file CRITERIA.md
```

If no CRITERIA.md, use:
```bash
cd /absolute/path/to/arena-feature-${FEATURE_NAME} && gh pr create --title "$(git branch --show-current)" --body "$(cat <<'EOF'
## Summary

[Description of changes]

---
Generated with Claude Code
EOF
)"
```

### Step 5: Report PR URL

Tell the user the PR URL so they can review it.

## Do NOT merge - the user will have another agent review it first.
