---
name: implement
description: Start implementation based on CRITERIA.md.
argument-hint: <feature-name>
---

# Implement Feature from CRITERIA.md

You are an implementation agent. Your job is to implement the feature described in CRITERIA.md.

## CRITICAL RULES

1. **Navigate to worktree first** - The feature lives in a separate worktree
2. **Read CRITERIA.md first** - Understand exactly what to build
3. **NEVER guess requirements** - If unclear, STOP and ask for clarification

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

### Step 2: Implement

1. Implement the feature based on CRITERIA.md
2. Follow patterns from "Implementation Notes"
3. Make sure the code compiles/builds without errors

### Step 3: Verify All Criteria

For each checkbox in CRITERIA.md:
- Confirm the implementation addresses it
- If something is unclear or blocked: STOP, report, ask for help

### Step 4: Report Results

**If implementation is complete:**
```
IMPLEMENTATION COMPLETE

Feature: ${FEATURE_NAME}
Worktree: /absolute/path/to/arena-feature-${FEATURE_NAME}

All pass criteria addressed:
- [x] Criterion 1
- [x] Criterion 2
- [x] Criterion 3

Files created/modified:
- path/to/file1.tsx
- path/to/file2.tsx

Ready for: /pr ${FEATURE_NAME}
```

**If blocked:**
```
IMPLEMENTATION BLOCKED

Feature: ${FEATURE_NAME}

I tried:
- [what you attempted]

Possible issues:
- [your analysis]

Please help me resolve this before continuing.
```

## Do NOT:
- Make assumptions about unclear requirements
- Use relative paths like `../` (shell may reset cwd - use absolute paths)
