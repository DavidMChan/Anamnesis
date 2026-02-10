---
name: worktree-clean
description: Remove a git worktree and delete its branch
argument-hint: <feature-name>
---

# Clean Worktree

Remove the specified worktree AND delete its branch.

## Steps

### Step 1: Normalize Feature Name

The argument `$ARGUMENTS` could be:
- Just the feature name: `ui-overhaul`
- With prefix: `arena-feature-ui-overhaul`
- Or the branch name: `feature/ui-overhaul`

```bash
FEATURE_NAME="$ARGUMENTS"
FEATURE_NAME="${FEATURE_NAME#arena-feature-}"
FEATURE_NAME="${FEATURE_NAME#feature/}"
```

### Step 2: List Current Worktrees

```bash
git worktree list
```

Find the absolute path for `arena-feature-${FEATURE_NAME}` from the output.

### Step 3: Remove the Worktree

```bash
git worktree remove /absolute/path/to/arena-feature-${FEATURE_NAME} --force
```

The `--force` flag removes even if there are uncommitted changes.

### Step 4: Delete the Branch

```bash
git branch -D feature/${FEATURE_NAME}
```

This deletes the local branch. The `-D` flag force-deletes even if not merged.

### Step 5: Clean Up Remote Branch (if exists)

```bash
git push origin --delete feature/${FEATURE_NAME} 2>/dev/null || echo "No remote branch to delete"
```

### Step 6: Confirm Removal

```bash
git worktree list
git branch -a | grep ${FEATURE_NAME} || echo "Branch fully cleaned up"
```

Report to user:
```
WORKTREE CLEANED

Removed:
- Worktree: /absolute/path/to/arena-feature-${FEATURE_NAME}
- Branch: feature/${FEATURE_NAME}
- Remote: origin/feature/${FEATURE_NAME} (if existed)
```

## Notes

- This is a destructive operation - all uncommitted changes in the worktree will be lost
- The branch will be deleted even if not merged to main
- Use this after a PR is merged or to abandon a feature
