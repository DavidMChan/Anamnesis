# Virtual Personas Arena - Project Context

## Overview

A web platform for running surveys on AI-generated backstories, part of the Virtual Personas research at UC Berkeley BAIR.

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS v4
- **UI Components**: shadcn/ui (Radix primitives)
- **Database**: Supabase (PostgreSQL + Auth)
- **Queue**: RabbitMQ (for worker tasks)
- **Worker**: Python (to be integrated with existing lab code)

## Project Structure

```
virtual-personas-arena/
├── frontend/                # React app
│   ├── src/
│   │   ├── components/      # UI components
│   │   │   ├── ui/          # shadcn/ui base components
│   │   │   ├── layout/      # Navbar, Layout, ProtectedRoute
│   │   │   ├── surveys/     # Survey-related components
│   │   │   └── backstories/ # Backstory-related components
│   │   ├── pages/           # Route pages
│   │   ├── hooks/           # Custom React hooks
│   │   ├── lib/             # Utilities (supabase client, utils)
│   │   ├── contexts/        # React contexts (AuthContext)
│   │   └── types/           # TypeScript types
│   └── .env                 # Supabase credentials (not committed)
├── worker/                  # Python worker (TODO: integrate with lab code)
├── supabase/
│   └── migrations/          # SQL migration files
├── docs/                    # Documentation
│   └── PLAN.md              # Implementation phases
└── CLAUDE.md                # This file
```

## Database Schema

### Tables

1. **users** - User accounts with LLM config
2. **backstories** - Backstory pool with demographics (JSONB)
3. **surveys** - User surveys with questions and results
4. **demographic_keys** - Metadata about demographic types (numeric/enum/text)

### Key Concepts

- **Backstory demographics**: Stores specific values (e.g., `age: 28`, `gender: "female"`)
- **Survey demographic filters**: Stores conditions (e.g., `age: {min: 18, max: 35}`, `gender: ["female", "male"]`)
- **demographic_keys**: Defines what demographics exist and their types for dynamic UI

## Current Status

See `docs/PLAN.md` for implementation phases and progress.

## Development Commands

```bash
# Frontend
cd frontend
npm install
npm run dev      # Start dev server at localhost:5173
npm run build    # Production build
npm run preview  # Preview production build

# Worker (TODO)
cd worker
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python consumer.py
```

## Testing Strategy

- **Unit tests**: Vitest for frontend components (TODO)
- **E2E tests**: Playwright (TODO)
- **Manual testing**: Test each feature after implementation

## Environment Variables

### Frontend (.env)
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx
```

### Worker (.env)
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=xxx
RABBITMQ_URL=amqp://...
```

## Related Codebases

- **Anthology** (`../anthology/`) - Original paper implementation
- **Alterity** (`../alterity-private-main/`) - Follow-up research

The worker should eventually integrate with Alterity's LLM inference code.
