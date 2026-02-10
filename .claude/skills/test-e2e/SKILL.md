---
name: test-e2e
description: Run only Playwright E2E tests
---

# Run E2E Tests Only

## Steps

1. **Run Playwright E2E Tests**:
   ```bash
   cd frontend && npm run test:e2e
   ```

2. **Report results** - If any fail, STOP and show errors

## Output Format

```
═══════════════════════════════════════
  E2E TEST RESULTS
═══════════════════════════════════════

E2E Tests: PASSED / FAILED

[If failed, show specific error messages and which tests failed]
═══════════════════════════════════════
```
