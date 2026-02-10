---
name: pr
description: Create a pull request. ONLY proceeds if ALL tests pass.
---

# Create Pull Request

## CRITICAL RULES

1. **MUST run ALL tests first** - Never skip this step
2. **If ANY test fails**: STOP immediately, do NOT create PR
3. **Only create PR when all tests pass**

## Steps

1. **Check current branch**:
   ```bash
   git branch --show-current
   ```
   - If on `main`: ERROR - "Cannot create PR from main branch"

2. **Run ALL tests** (same as /test skill):
   - Frontend unit tests
   - Worker tests
   - E2E tests

   **If ANY test fails**:
   ```
   CANNOT CREATE PR

   Tests are failing. Please fix the following issues:
   [Show error details]

   Run /test to see full results.
   ```
   **STOP HERE. Do not proceed.**

3. **If all tests pass**, check for CRITERIA.md:
   ```bash
   cat CRITERIA.md 2>/dev/null || echo "No CRITERIA.md found"
   ```

4. **Push branch**:
   ```bash
   git push -u origin $(git branch --show-current)
   ```

5. **Create PR** using gh cli:
   - Title: branch name (e.g., "feature/login")
   - Body: Contents of CRITERIA.md if exists, otherwise default template

   ```bash
   gh pr create --title "$(git branch --show-current)" --body-file CRITERIA.md
   ```

   If no CRITERIA.md, use:
   ```bash
   gh pr create --title "$(git branch --show-current)" --body "## Summary

   [Description of changes]

   ## Test Plan

   - [ ] Unit tests pass
   - [ ] E2E tests pass

   ---
   Generated with Claude Code"
   ```

6. **Report the PR URL** to the user

## Do NOT merge - the user will have another agent review it first.
