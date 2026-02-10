---
name: plan-feature
description: Start planning a new feature. Discuss requirements with the user and create detailed CRITERIA.md for implementation.
argument-hint: <feature-name>
---

# Plan Feature - PM to TDD Conversion

You are acting as a PM helping the user convert their feature idea into concrete TDD criteria.

## Your Role

1. **Understand the feature** - Ask clarifying questions about:
   - What exactly should this feature do?
   - What are the edge cases?
   - What error handling is needed?
   - Are there any UI/UX requirements?
   - Any integration points with existing code?

2. **Explore the codebase** - Look at existing patterns:
   - How are similar features implemented?
   - What components/modules will be affected?
   - Are there existing tests to reference?

3. **Draft the spec** - Write a detailed CRITERIA.md with:
   - Clear description of the feature
   - Technical approach (which files to modify/create)
   - Detailed test cases (unit + e2e)
   - Acceptance criteria with checkboxes
   - Any notes for the implementing agent

## Steps

1. **Create worktree** (if not exists):
   ```bash
   git branch "feature/$ARGUMENTS" 2>/dev/null || true
   git worktree add "../arena-feature-$ARGUMENTS" "feature/$ARGUMENTS"
   ```

2. **Start discussion** - Ask the user about their requirements

3. **Explore codebase** - Find relevant existing code and patterns

4. **Write CRITERIA.md** - Create detailed spec (see template below)

5. **Review with user** - Confirm the criteria are correct before implementation

## CRITERIA.md Template

Write to `../arena-feature-$ARGUMENTS/CRITERIA.md`:

```markdown
# Feature: [Feature Name]

## Status
- [ ] Planning complete
- [ ] Ready for implementation

## Description
[2-3 sentences describing what this feature does from user perspective]

## Technical Approach

### Files to Create
- `frontend/src/components/[Name].tsx` - [purpose]
- `frontend/tests/[name].test.tsx` - [test file]

### Files to Modify
- `frontend/src/pages/[Page].tsx` - [what changes]
- `frontend/src/App.tsx` - [add route if needed]

### Key Decisions
- [Decision 1]: [Why this approach]
- [Decision 2]: [Why this approach]

## Pass Criteria

### Unit Tests
- [ ] [Specific test case with expected behavior]
- [ ] [Specific test case with expected behavior]
- [ ] [Edge case handling]

### E2E Tests
- [ ] [User flow: step by step what user does and sees]
- [ ] [Error scenario: what happens on failure]

### Acceptance Criteria
- [ ] [Observable behavior 1]
- [ ] [Observable behavior 2]
- [ ] [Performance/accessibility if relevant]

## Implementation Notes

### For the Implementing Agent
- Start by writing tests for the pass criteria above
- Reference existing patterns in: [file paths]
- Don't forget to: [common gotchas]

### Test Data
- Use `test+${Date.now()}@example.com` for unique emails
- [Other test data notes]

## Out of Scope
- [Things explicitly NOT included in this feature]
```

## Important

- Do NOT start implementing. Your job is to create a clear spec.
- The spec should be detailed enough for another agent to implement without asking questions.
- After writing CRITERIA.md, tell the user to run `/implement` when ready.
