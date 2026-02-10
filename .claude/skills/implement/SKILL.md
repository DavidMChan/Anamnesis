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

### Step 0: Find Feature Worktree

The argument `$ARGUMENTS` could be:
- Just the feature name: `ui-overhaul`
- With prefix: `arena-feature-ui-overhaul`
- Or the branch name: `feature/ui-overhaul`

**Normalize the feature name first:**
```bash
# Strip prefixes to get clean feature name
FEATURE_NAME="$ARGUMENTS"
FEATURE_NAME="${FEATURE_NAME#arena-feature-}"  # Remove arena-feature- prefix if present
FEATURE_NAME="${FEATURE_NAME#feature/}"        # Remove feature/ prefix if present
```

The worktree path is: `../arena-feature-${FEATURE_NAME}`

```bash
# List worktrees to find the correct path
git worktree list
```

```bash
# Verify worktree exists
ls ../arena-feature-${FEATURE_NAME}/CRITERIA.md
```

If the worktree doesn't exist, tell the user:
```
ERROR: Worktree not found for feature: ${FEATURE_NAME}

Expected path: ../arena-feature-${FEATURE_NAME}

Run /plan-feature ${FEATURE_NAME} first to create the worktree and CRITERIA.md
```

**IMPORTANT**: All subsequent commands must use the ABSOLUTE PATH to the worktree.
- Get the absolute path from `git worktree list` output
- Example: `/Users/name/project/arena-feature-ui-overhaul`

### Step 1: Read the Spec

Use the absolute path from worktree list:
```bash
cat /absolute/path/to/arena-feature-${FEATURE_NAME}/CRITERIA.md
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
# Run tests from worktree - use absolute path
cd /absolute/path/to/arena-feature-${FEATURE_NAME}/frontend && npm run test:run
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

Feature: ${FEATURE_NAME}
Worktree: /absolute/path/to/arena-feature-${FEATURE_NAME}

All pass criteria met:
- [x] Criterion 1
- [x] Criterion 2
- [x] Criterion 3

Files created/modified:
- path/to/file1.tsx
- path/to/file2.tsx

Ready for: /pr ${FEATURE_NAME}
```

**If ANY test fails:**
```
IMPLEMENTATION BLOCKED

Feature: ${FEATURE_NAME}

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
- Use relative paths like `../` (shell may reset cwd - use absolute paths)
