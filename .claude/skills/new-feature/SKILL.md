---
name: new-feature
description: Quick start a new feature worktree with blank CRITERIA.md template (use /plan-feature for guided planning)
argument-hint: <feature-name>
---

# Quick Start New Feature

Create a new feature worktree with a blank template. Use this when you already know what you want to build.

For guided planning with discussion, use `/plan-feature` instead.

## Steps

1. **Create the branch and worktree**:
   ```bash
   git branch "feature/$ARGUMENTS" 2>/dev/null || true
   git worktree add "../arena-feature-$ARGUMENTS" "feature/$ARGUMENTS"
   ```

2. **Copy environment files** (gitignored files don't transfer to worktrees):
   ```bash
   cp frontend/.env "../arena-feature-$ARGUMENTS/frontend/.env" 2>/dev/null || true
   cp worker/.env "../arena-feature-$ARGUMENTS/worker/.env" 2>/dev/null || true
   ```

3. **Create blank CRITERIA.md template** in the new worktree with the following structure:

```markdown
# Feature: $ARGUMENTS

## Status
- [ ] Planning complete
- [ ] Ready for implementation

## Description
[TODO: Describe what this feature does]

## Technical Approach

### Files to Create
- [TODO: List files to create]

### Files to Modify
- [TODO: List files to modify]

### Key Decisions
- [TODO: Document key technical decisions]

## Pass Criteria

### Unit Tests
- [ ] [TODO: Add test criteria]

### E2E Tests
- [ ] [TODO: Add e2e test criteria]

### Acceptance Criteria
- [ ] [TODO: Add acceptance criteria]

## Implementation Notes

### For the Implementing Agent
- [TODO: Add notes]

### Test Data
- Use `test+${Date.now()}@example.com` for unique emails

## Out of Scope
- [TODO: List what's not included]
```

4. **Report success** with next steps:
   - Tell user worktree created at `../arena-feature-$ARGUMENTS`
   - Tell user to edit CRITERIA.md with their requirements
   - Tell user to run `/implement` when ready
