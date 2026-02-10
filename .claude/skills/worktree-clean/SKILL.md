---
name: worktree-clean
description: Remove a git worktree
argument-hint: <worktree-name>
---

# Clean Worktree

Remove the specified worktree.

## Steps

1. **List current worktrees** to confirm the target exists:
   ```bash
   git worktree list
   ```

2. **Remove the worktree**:
   ```bash
   git worktree remove "../arena-feature-$ARGUMENTS" --force
   ```

3. **Optionally delete the branch** (ask user first):
   ```bash
   git branch -D "feature/$ARGUMENTS"
   ```

4. **Confirm removal** to user with updated worktree list.

## Notes
- The `--force` flag is used to remove even if there are uncommitted changes
- Always confirm with the user before deleting the branch
