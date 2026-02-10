---
name: test
description: Run all tests (unit + e2e + worker) and report results. STOPS if any test fails.
---

# Run All Tests

Execute the complete test suite and report results.

## CRITICAL RULES

1. **NEVER skip failing tests** - If a test fails, STOP and report the failure
2. **NEVER mark criteria as passed if tests fail**
3. **If blocked, tell the user exactly what's failing and ask them to fix it**

## Steps

1. **Run Frontend Unit Tests**:
   ```bash
   cd frontend && npm run test:run
   ```
   - If this fails: STOP, show the error output, tell the user which tests failed

2. **Run Worker Tests** (if worker/tests exists):
   ```bash
   cd worker && python -m pytest
   ```
   - If this fails: STOP, show the error output, tell the user which tests failed

3. **Run E2E Tests**:
   ```bash
   cd frontend && npm run test:e2e
   ```
   - If this fails: STOP, show the error output, tell the user which tests failed

4. **Report Results**:
   - If ALL tests pass: "All tests passed! Ready for /pr"
   - If ANY test fails: "Tests failed. Please fix the issues above before proceeding."

## Output Format

```
═══════════════════════════════════════
  TEST RESULTS
═══════════════════════════════════════

Frontend Unit Tests: PASSED / FAILED
Worker Tests:        PASSED / FAILED / SKIPPED (no tests)
E2E Tests:           PASSED / FAILED

[If failed, show specific error messages here]

═══════════════════════════════════════
```
