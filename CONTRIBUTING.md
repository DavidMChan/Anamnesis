# Contributing to Virtual Personas Arena

## TDD Workflow

This project uses Claude Skills for Test-Driven Development with a PM → Developer handoff pattern.

### Available Commands

| Command | Description |
|---------|-------------|
| `/plan-feature <name>` | **Recommended** - Discuss requirements and create detailed CRITERIA.md |
| `/new-feature <name>` | Quick start with blank template (skip planning) |
| `/implement` | Start implementation agent based on CRITERIA.md |
| `/test` | Run all tests (unit + e2e + worker) |
| `/test-unit` | Run unit tests only |
| `/test-e2e` | Run E2E tests only |
| `/pr` | Create PR (only if tests pass) |
| `/worktree-list` | List all worktrees |
| `/worktree-clean <name>` | Remove a worktree |

### Recommended Workflow

```
Phase 1: Planning
─────────────────
/plan-feature login
↓
(Discuss requirements with Claude)
↓
CRITERIA.md created with detailed spec

Phase 2: Implementation
───────────────────────
/implement
↓
(Reads CRITERIA.md)
(Writes tests first, then implements)
(Stops if tests fail)

Phase 3: PR
───────────
/pr
↓
(Creates PR if all tests pass)
(Ready for code review)
```

### CRITERIA.md Format

Each feature has a detailed spec that serves as the handoff document:

```markdown
# Feature: Login

## Status
- [x] Planning complete
- [ ] Ready for implementation

## Description
User can log in with email and password...

## Technical Approach
### Files to Create
- frontend/src/pages/Login.tsx
- frontend/tests/login.test.tsx

### Files to Modify
- frontend/src/App.tsx - add route

## Pass Criteria

### Unit Tests
- [ ] Login form validates email format
- [ ] Error message shows for invalid credentials

### E2E Tests
- [ ] User can register with test+timestamp@example.com
- [ ] User can login and see dashboard

## Implementation Notes
- Reference existing auth patterns in AuthContext.tsx
- Use test+${Date.now()}@example.com for unique emails
```

### Test Structure

```
frontend/
├── tests/          # Unit tests (Vitest)
└── e2e/            # E2E tests (Playwright)

worker/
└── tests/          # Python tests (Pytest)
```

### Running Tests Locally

```bash
# Frontend unit tests
cd frontend
npm run test        # Watch mode
npm run test:run    # Single run
npm run test:ui     # UI mode

# Frontend E2E tests
cd frontend
npm run test:e2e    # Headless
npm run test:e2e:ui # UI mode

# Worker tests
cd worker
pytest              # Run all tests
pytest -v           # Verbose
```

### Key Principles

1. **Tests fail? STOP.** - Never skip failing tests or proceed to PR
2. **Spec is the contract** - CRITERIA.md must be clear enough for autonomous implementation
3. **TDD** - Write tests first, then implement
4. **Agent handoff** - Planning and implementation are separate contexts

### Git Worktree Workflow

This project uses git worktrees to isolate feature work:

```bash
# Create new feature worktree (done by /plan-feature or /new-feature)
git worktree add ../arena-feature-login feature/login

# List all worktrees
git worktree list

# Remove worktree (done by /worktree-clean)
git worktree remove ../arena-feature-login

# Delete branch after merge
git branch -d feature/login
```

### CI/CD

GitHub Actions automatically run tests on PRs:

- **test-frontend.yml**: Runs unit tests and E2E tests for frontend changes
- **test-worker.yml**: Runs pytest for worker changes

Required secrets for E2E tests:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
