# Anamnesis — Project Context

## Overview

**Anamnesis** is a research platform for running surveys on LLM-simulated human personas, developed at UC Berkeley BAIR. It enables researchers to define survey instruments, execute them against large backstory pools via LLM inference, and analyze the resulting response distributions — all through a web interface.

The name *anamnesis* (ἀνάμνησις) refers to the Platonic concept of recollection: the idea that knowledge is recovered from within. Here, backstories serve as that inner context — recovering a specific human perspective from within the model.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS v4
- **UI Components**: shadcn/ui (Radix primitives) + Recharts
- **Database**: Supabase (PostgreSQL + Auth + Vault)
- **Queue**: RabbitMQ (task dispatch + fan-out)
- **Worker**: Python async (asyncio + aio_pika)
- **Media Storage**: Wasabi S3-compatible object storage
- **LLM Providers**: OpenRouter (70+ models) + vLLM (self-hosted)

## Project Structure

```
anamnesis/                           # (repo: virtual-personas-arena)
├── frontend/                        # React app
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                  # shadcn/ui base components
│   │   │   ├── layout/              # Navbar, Sidebar, ProtectedRoute
│   │   │   ├── surveys/             # QuestionEditor, DemographicFilter, RunConfigCard
│   │   │   ├── results/             # ResultsTable, DistributionChart, RankingResults
│   │   │   └── demographic-surveys/ # DemographicKeyForm
│   │   ├── pages/                   # 14 route pages
│   │   ├── hooks/                   # useAuth, useSurveyRun, use-toast
│   │   ├── lib/                     # supabase, surveyRunner, backstoryFilters,
│   │   │   │                        # backstoryScoring, demographicPrompt,
│   │   │   │                        # hungarianMatching, media, apiKeyUtils
│   │   ├── contexts/                # AuthContext
│   │   └── types/                   # database.ts (all TypeScript types)
│   ├── tests/                       # Vitest unit tests
│   └── e2e/                         # Playwright E2E tests
├── worker/
│   └── src/
│       ├── main.py                  # Async event loop + message handler
│       ├── dispatcher.py            # Polls DB, throttles, publishes to RabbitMQ
│       ├── worker.py                # TaskProcessor + FillingStrategy (3 variants)
│       ├── llm.py                   # UnifiedLLMClient (OpenRouter + vLLM)
│       ├── prompt.py                # Prompt construction (anthology format)
│       ├── parser.py                # ParserLLM (Tier 2 MCQ fallback)
│       ├── logprobs.py              # Token logprobs → MCQ distribution
│       ├── db.py                    # Supabase operations
│       ├── queue.py                 # RabbitMQ producer/consumer
│       ├── media.py                 # WasabiMediaClient
│       ├── metrics.py               # LatencyTracker
│       ├── response.py              # LLMResponse, error types
│       └── config.py                # Config from env
├── supabase/
│   └── migrations/                  # 23 ordered SQL migrations
├── docs/
│   └── DEPLOYMENT.md                # Ubuntu 24.04 deployment guide
├── docker-compose.yml               # RabbitMQ + Dispatcher + Worker
└── CLAUDE.md                        # This file
```

## Database Schema

### Core Tables

| Table | Purpose |
|-------|---------|
| `users` | Auth + LLM config per user |
| `backstories` | Persona text pool with demographics (JSONB) |
| `surveys` | Survey definitions (questions JSONB, demographics filter JSONB) |
| `survey_runs` | Execution instances with snapshotted config + algorithm |
| `survey_tasks` | One row per (run, backstory) pair; atomic state machine |
| `demographic_keys` | User-defined demographic dimensions with completion status |

### Key Concepts

- **Backstory demographics**: Concrete values (`age: 28`, `gender: "female"`)
- **Survey demographic filters**: Conditions (`age: {min: 18, max: 35}`, `gender: ["female"]`)
- **demographic_keys**: Defines custom dimensions, populated by running demographic surveys
- **survey_runs.algorithm**: `anthology` (backstory-conditioned) or `zero_shot_baseline`
- **survey_tasks.status**: `pending → queued → processing → completed/failed`

### Key RPCs

| RPC | Purpose |
|-----|---------|
| `start_task(id)` | Atomic: set processing + increment attempts |
| `complete_task(id, result)` | Atomic: mark done + store result |
| `fail_task(id, error)` | Atomic: mark failed + store error |
| `append_run_result(run_id, backstory_id, result)` | Merge into results JSONB |
| `write_demographic_result(backstory_id, key, value, dist)` | Write demographic to backstory |
| `store_my_api_key(type, key)` / `get_my_masked_api_key(type)` | Vault ops |

## Worker Architecture

### Filling Strategies (Strategy Pattern)

Three pluggable algorithms, selected at runtime from `survey_runs.algorithm` and `llm_config.distribution_mode`:

| Strategy | When | Description |
|----------|------|-------------|
| `SeriesWithContext` | Anthology algorithm | Questions in series; each sees prior Q&A (context accumulation). Two-tier MCQ parsing: structured output + parser LLM fallback. |
| `IndependentRepeat` | Demographic survey, n_sample mode | Single question asked N times independently. Returns `"A\|\|B\|\|A\|\|..."` for distribution computation. |
| `LogprobsSingle` | Demographic survey, logprobs mode | Single call with `logprobs=True`; token log-probabilities → MCQ distribution. ~20× cheaper than IndependentRepeat. |

### Two-Tier MCQ Parsing

1. **Tier 1**: Structured output — vLLM `structured_outputs` (guided decoding) or OpenRouter JSON schema
2. **Tier 2**: Parser LLM fallback — send raw response to a fast model (Gemini Flash) to extract letter

### LLM Provider Abstraction

`UnifiedLLMClient` wraps OpenAI SDK and works with both OpenRouter and vLLM:

```python
UnifiedLLMClient(
    base_url="https://openrouter.ai/api/v1",  # or vLLM endpoint
    model="anthropic/claude-3-haiku",
    use_chat_template=False,     # completions vs chat
    use_guided_decoding=True,    # vLLM constrained sampling
    temperature=0.0,
)
```

### Dispatcher Throttling

- Polls DB for pending survey runs
- Reads `max_concurrent_tasks` from each run's `llm_config` snapshot
- Tracks in-flight task count per run; only publishes up to the concurrency limit
- Adaptive polling: 1s (busy), 3s (active), 5s (idle)

## Development Commands

```bash
# Frontend
cd frontend && npm install
npm run dev          # localhost:5173
npm run test         # Vitest unit tests
npm run test:e2e     # Playwright E2E

# Worker (local)
cd worker
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python main.py       # Start async worker

# Full stack (Docker)
docker compose up -d
docker compose up -d --scale worker=4   # 4 parallel workers
```

## Environment Variables

### Frontend (`frontend/.env`)
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx
```

### Worker / Docker (`.env`)
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx
RABBITMQ_URL=amqp://arena:password@rabbitmq:5672/
RABBITMQ_USER=arena
RABBITMQ_PASS=xxx
WASABI_ACCESS_KEY_ID=xxx        # optional, for media surveys
WASABI_SECRET_ACCESS_KEY=xxx
WASABI_BUCKET=xxx
```

LLM API keys are stored per-user in Supabase Vault (not env vars).

## CI/CD

- `.github/workflows/test-frontend.yml` — Vitest + Playwright on PRs
- `.github/workflows/test-worker.yml` — Pytest on PRs

## Related Codebases

- **Anthology** (`../anthology/`) — 2024 paper implementation (arXiv:2407.06576)
- **Alterity** (`../alterity-private-main/`) — Follow-up research; LLM-interview backstory generation

*Last Updated: 2026-02-25*
