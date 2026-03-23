# Anamnesis

**Anamnesis** is a web-based research platform for running opinion surveys on LLM-simulated human personas. Researchers define survey instruments, execute them against large pools of naturalistic backstories via LLM inference, and analyze the resulting response distributions - all through a unified interface.

The platform operationalizes the *Virtual Personas* methodology, Anthology, enabling systematic, large-scale evaluation of persona simulation at the level of individual response distributions rather than aggregate population statistics.

> *Anamnesis* (ἀνάμνησις): the Platonic concept of recollection - recovering knowledge from within. Here, backstories serve as that inner context, eliciting a specific human perspective from within the model.

---

## Key Features

- **Survey Builder** - Create surveys with MCQ, multi-select, open-response, and ranking questions; attach image/audio media to questions and answer options
- **Persona Targeting** - Filter backstories by demographic dimensions (age, gender, political affiliation, education, etc.) with distribution-balanced or top-K sampling
- **Two Inference Algorithms** - *Anthology* (backstory-conditioned, sequential context accumulation) and *Zero-Shot Baseline* (demographic prompt, N-sample averaging)
- **Demographic Survey Tool** - Define custom demographic dimensions; populate them across the backstory pool using LLM inference (N-sample or logprobs mode)
- **Real-Time Progress** - Monitor active runs with live progress and per-task status
- **Results & Export** - Bar/pie charts, response tables, Borda-score ranking summaries, CSV export with demographic breakdowns
- **API Key Vault** - Per-user encrypted API key storage (Supabase Vault); supports OpenRouter and self-hosted vLLM

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Browser (React + TypeScript + Vite)                          │
│  Survey Builder │ Backstory Browser │ Results Dashboard       │
└────────────────────────┬──────────────────────────────────────┘
                         │  Supabase JS SDK (RLS-enforced)
┌────────────────────────▼──────────────────────────────────────┐
│  Supabase (PostgreSQL + Auth + Vault)                         │
│  users │ backstories │ surveys │ survey_runs │ survey_tasks   │
└──────────┬─────────────────────────────────────────────────────┘
           │  Service Role (worker/dispatcher)
┌──────────▼────────────┐      ┌─────────────────────────────────┐
│  Dispatcher (Python)  │──────▶  RabbitMQ                       │
│  Poll → Throttle      │      │  survey_tasks queue             │
│  → Publish tasks      │      └──────────────┬──────────────────┘
└───────────────────────┘                     │
                                   ┌──────────▼──────────┐
                                   │  Worker(s) (Python) │  ×N
                                   │  Async, scalable    │
                                   └──────────┬──────────┘
                                              │  API calls
                                   ┌──────────▼──────────┐
                                   │  LLM Providers      │
                                   │  OpenRouter / vLLM  │
                                   └─────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS v4, shadcn/ui |
| Charts | Recharts |
| Database | Supabase (PostgreSQL 15, Row-Level Security, Vault) |
| Task Queue | RabbitMQ 3 |
| Worker | Python 3.11, asyncio, aio_pika |
| LLM (cloud) | OpenRouter (OpenAI-compatible API, 70+ models) |
| LLM (local) | vLLM (guided decoding, logprobs) |
| Media Storage | Wasabi (S3-compatible) |
| Containers | Docker Compose |

---

## Quick Start

### Prerequisites

- Node.js 18+, Python 3.11+
- Supabase project (free tier works)
- Docker + Docker Compose (for worker stack)
- OpenRouter API key **or** vLLM endpoint

### 1. Frontend

```bash
cd frontend
npm install
cp .env.example .env
# Edit .env: add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev         # http://localhost:5173
```

### 2. Database

Run migrations in order in your Supabase SQL editor:

```bash
ls supabase/migrations/   # apply in filename order
```

### 3. Worker Stack

```bash
cp .env.example .env
# Edit .env: SUPABASE_URL, SUPABASE_SERVICE_KEY, RABBITMQ_USER, RABBITMQ_PASS

docker compose up -d
docker compose up -d --scale worker=4   # scale to 4 parallel workers
```

LLM API keys are stored per-user in the Supabase Vault via the Settings page.

---

## Survey Algorithms

### Anthology (Default)

Replicates the backstory-conditioned approach from our EACL 2024 paper:

1. Prepend the full backstory to the first question
2. Record the LLM's answer
3. For each subsequent question, prepend all prior Q&A pairs (context accumulation)
4. Parse answers using structured output (Tier 1) + parser LLM fallback (Tier 2)

This promotes response consistency across questions - the LLM "remembers" what it has said.

### Zero-Shot Baseline

Constructs a short demographic description from the backstory's structured attributes (age, gender, education, etc.) and asks each question N times independently. The final answer is the majority vote across N trials. Used for ablation comparison against the full backstory-conditioned method.

---

## Demographic Surveys

Anamnesis can populate custom demographic attributes across the backstory pool by running dedicated demographic surveys:

1. Define a dimension (e.g., `political_affiliation` with options `Democrat / Republican / Independent`)
2. Run in **N-sample mode** (ask N times, compute frequency distribution) or **logprobs mode** (extract token probability distribution in a single call - ~20× cheaper, requires vLLM)
3. The resulting distribution is stored in each backstory's `demographics` JSONB field
4. Future opinion surveys can filter and sample backstories by this dimension

---

## Project Structure

```
anamnesis/
├── frontend/src/
│   ├── pages/          # 14 route pages
│   ├── components/     # UI, layout, surveys, results, demographic-surveys
│   ├── lib/            # surveyRunner, backstoryFilters, backstoryScoring,
│   │                   # demographicPrompt, hungarianMatching, media, apiKeyUtils
│   ├── hooks/          # useAuth, useSurveyRun
│   └── types/          # database.ts (all TypeScript types)
├── worker/src/
│   ├── main.py         # Async event loop + message handler
│   ├── dispatcher.py   # DB polling, concurrency throttling
│   ├── worker.py       # TaskProcessor + 3 FillingStrategies
│   ├── llm.py          # UnifiedLLMClient (OpenRouter + vLLM)
│   ├── prompt.py       # Anthology prompt format
│   ├── parser.py       # Tier 2 MCQ parser LLM
│   └── logprobs.py     # Token log-prob → distribution
├── supabase/migrations/ # 23 SQL migrations
└── docker-compose.yml  # RabbitMQ + Dispatcher + Worker
```

---

## Research Context

This platform is part of the **Virtual Personas** research program at UC Berkeley's BAIR lab (Prof. Trevor Darrell, postdoc David Chan), exploring how language models can be conditioned with naturalistic backstories to simulate individual human perspectives rather than aggregate population behavior.

### Related Work

- **Anthology** (`../anthology/`) - Original implementation for *"Virtual Personas for Language Models via an Anthology of Backstories"* (EACL 2024, arXiv:2407.06576)
- **Alterity** (`../alterity-private-main/`) - Follow-up research on belief consistency using LLM-interview-generated backstories

---

## Development

```bash
# Unit tests (frontend)
cd frontend && npm run test

# E2E tests (frontend)
npm run test:e2e

# Worker tests
cd worker && pytest

# Full CI equivalent
# See .github/workflows/
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for production deployment on Ubuntu 24.04.

Updated: 3/23/2026
