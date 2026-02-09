# Virtual Personas Arena - Implementation Plan

## Phase Overview

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Project Setup & Auth | IN PROGRESS |
| 2 | Survey CRUD | BLOCKED (need auth working) |
| 3 | Backstory Management | BLOCKED |
| 4 | Worker Integration | NOT STARTED |
| 5 | Results & Analytics | NOT STARTED |
| 6 | Polish & Deploy | NOT STARTED |

---

## Phase 1: Project Setup & Auth

### Tasks

- [x] Initialize React + Vite + TypeScript project
- [x] Configure Tailwind CSS v4
- [x] Create shadcn/ui components
- [x] Set up Supabase client
- [x] Create database schema (001_initial_schema.sql)
- [x] Create demographic_keys table (002_demographic_keys.sql)
- [x] Implement auth pages (Login, Register)
- [x] Implement auth hook and context
- [x] Create protected routes
- [x] **TEST: Login flow** - PASS (shows proper error for invalid credentials)
- [x] **TEST: Register flow** - PASS (Supabase validates email, rejects example.com)
- [ ] **TEST: Register with real email**
- [ ] **TEST: Login after registration**
- [ ] **TEST: Logout**
- [ ] **TEST: Protected route redirect**

### Known Issues

None currently - auth flow working after .env fix.

### Testing Checklist

```
[ ] User can register with email/password
[ ] User receives confirmation (or auto-confirms in dev)
[ ] User can login
[ ] User can logout
[ ] Unauthenticated user redirected to /login
[ ] User profile created in public.users table
```

---

## Phase 2: Survey CRUD

### Tasks

- [x] Survey list page
- [x] Survey create/edit form
- [x] Question editor component (MCQ, multi-select, open response, ranking)
- [x] Dynamic demographic filter component
- [ ] **TEST: Create survey with questions**
- [ ] **TEST: Edit existing survey**
- [ ] **TEST: Delete survey**
- [ ] **TEST: Demographic filters save correctly**

### Testing Checklist

```
[ ] Can create survey with name
[ ] Can add MCQ question with options
[ ] Can add multi-select question
[ ] Can add open response question
[ ] Can add ranking question
[ ] Can add demographic filters (numeric range)
[ ] Can add demographic filters (enum checkboxes)
[ ] Can save as draft
[ ] Can edit saved survey
[ ] Can delete survey
```

---

## Phase 3: Backstory Management

### Tasks

- [x] Backstory list page (user's own)
- [x] Backstory upload form
- [x] Demographics input for backstories
- [ ] **TEST: Upload backstory with demographics**
- [ ] **TEST: View backstory details**
- [ ] **TEST: Delete backstory**
- [ ] Public/private visibility toggle

### Testing Checklist

```
[ ] Can upload backstory text
[ ] Can set demographic values (age, gender, etc.)
[ ] Can mark as public/private
[ ] Can view full backstory
[ ] Can delete own backstory
[ ] Cannot see others' private backstories
```

---

## Phase 4: Worker Integration

### Tasks

- [ ] Integrate with lab's existing LLM code (Alterity)
- [ ] Set up RabbitMQ connection
- [ ] Implement task enqueueing (Supabase Edge Function or API)
- [ ] Implement task consumer
- [ ] Run survey on backstories
- [ ] Update results in database
- [ ] Progress tracking

### Dependencies

- Need to understand Alterity codebase structure
- Need RabbitMQ instance (CloudAMQP or local)

---

## Phase 5: Results & Analytics

### Tasks

- [x] Results page with charts
- [x] CSV download
- [ ] Proper demographic filtering query
- [ ] Real-time progress updates
- [ ] **TEST: View results after survey completes**
- [ ] **TEST: Download CSV**

---

## Phase 6: Polish & Deploy

### Tasks

- [ ] Error handling improvements
- [ ] Loading states
- [ ] Mobile responsiveness
- [ ] Deploy frontend to Vercel
- [ ] Set up production Supabase
- [ ] Documentation

---

## Debug Log

### 2025-02-09: Login stuck issue - RESOLVED

**Symptom**: Clicking "Create account" shows "signing in..." forever

**Root cause**: .env had mismatched Supabase URL and key (different project refs)

**Resolution**: User fixed .env with correct credentials from Supabase dashboard

**Verification**: Tested login and registration flows with Playwright - both working

---

## Notes

- Worker code should reuse Alterity's LLM inference code, not be written from scratch
- Demographics are flexible JSONB - new demographic types can be added via `demographic_keys` table
- Survey filters use range queries for numeric, array matching for enums
