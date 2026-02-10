---
name: test-unit
description: Run only unit tests (frontend + worker)
---

# Run Unit Tests Only

## Steps

1. **Run Frontend Unit Tests**:
   ```bash
   cd frontend && npm run test:run
   ```

2. **Run Worker Tests** (if exists):
   ```bash
   cd worker && python -m pytest
   ```

3. **Report results** - If any fail, STOP and show errors

## Output Format

```
═══════════════════════════════════════
  UNIT TEST RESULTS
═══════════════════════════════════════

Frontend: PASSED / FAILED
Worker:   PASSED / FAILED / SKIPPED

[If failed, show specific error messages]
═══════════════════════════════════════
```
