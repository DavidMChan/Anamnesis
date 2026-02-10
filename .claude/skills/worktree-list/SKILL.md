---
name: worktree-list
description: List all git worktrees
---

# List Worktrees

Run:
```bash
git worktree list
```

Show the results in a formatted table with:
- Path
- Branch name
- Commit hash (short)

Example output:
```
═══════════════════════════════════════════════════════════════
  GIT WORKTREES
═══════════════════════════════════════════════════════════════

  Path                                    Branch
  ─────────────────────────────────────────────────────────────
  /path/to/virtual-personas-arena         main
  /path/to/arena-feature-login            feature/login
  /path/to/arena-feature-dashboard        feature/dashboard

═══════════════════════════════════════════════════════════════
```
