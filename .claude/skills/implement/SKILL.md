---
name: implement
description: Start implementation based on CRITERIA.md. Uses TDD workflow - write tests first, then implement.
argument-hint: <feature-name>
---

# Implement Feature from CRITERIA.md

You are an implementation agent. Your job is to implement the feature described in CRITERIA.md.

## CRITICAL RULES

1. **Navigate to worktree first** - The feature lives in a separate worktree
2. **Read CRITERIA.md first** - Understand exactly what to build
3. **Write tests FIRST** - This is TDD, tests before implementation
4. **NEVER skip failing tests** - If tests fail, STOP and report
5. **NEVER guess requirements** - If unclear, STOP and ask for clarification
6. **Commit working code only** - Don't commit if tests fail

## Workflow

### Step 0: Navigate to Feature Worktree

First, find and navigate to the feature worktree:

```bash
# List available worktrees
git worktree list
```

The feature worktree is at: `../arena-feature-$ARGUMENTS`

```bash
# Verify worktree exists and has CRITERIA.md
ls ../arena-feature-$ARGUMENTS/CRITERIA.md
```

If the worktree doesn't exist, tell the user:
```
ERROR: Worktree not found at ../arena-feature-$ARGUMENTS

Run /plan-feature $ARGUMENTS first to create the worktree and CRITERIA.md
```

**IMPORTANT**: All subsequent commands must be run from the worktree directory:
- Use `cd ../arena-feature-$ARGUMENTS && <command>` for bash commands
- Read files from `../arena-feature-$ARGUMENTS/` path

### Step 1: Read the Spec
```bash
cat ../arena-feature-$ARGUMENTS/CRITERIA.md
```
Understand:
- What feature to build
- Which files to create/modify
- What tests to write
- What the pass criteria are

### Step 2: Write Tests First (TDD)
Based on the "Pass Criteria" section:
1. Create test files in the worktree
2. Write failing tests for each criterion
3. Run tests to confirm they fail (red phase)

```bash
# Run tests from worktree
cd ../arena-feature-$ARGUMENTS/frontend && npm run test:run
```

### Step 3: Implement
1. Write the minimum code to make tests pass
2. Follow patterns from "Implementation Notes"
3. Run tests frequently

### Step 4: Verify All Criteria
For each checkbox in CRITERIA.md:
- Run the relevant test
- Confirm it passes
- If it fails: STOP, report the error, ask for help

### Step 5: Report Results

**If ALL tests pass:**
```
IMPLEMENTATION COMPLETE

Feature: $ARGUMENTS
Worktree: ../arena-feature-$ARGUMENTS

All pass criteria met:
- [x] Criterion 1
- [x] Criterion 2
- [x] Criterion 3

Files created/modified:
- path/to/file1.tsx
- path/to/file2.tsx

Ready for: /pr
(Run from the worktree directory)
```

**If ANY test fails:**
```
IMPLEMENTATION BLOCKED

Feature: $ARGUMENTS
Worktree: ../arena-feature-$ARGUMENTS

Failing tests:
- test name: error message

I tried:
- [what you attempted]

Possible issues:
- [your analysis]

Please help me resolve this before continuing.
```

## Do NOT:
- Skip any tests
- Mark criteria as done if tests fail
- Make assumptions about unclear requirements
- Commit code that doesn't pass tests
- Run commands in the main repo directory (always use worktree path)
