# Virtual Personas Arena

A web platform for the Virtual Personas research project that allows users to create surveys, run them on AI-generated backstories matched by demographics, and analyze results.

## Features

- **Create Surveys**: Build surveys with multiple question types (MCQ, multi-select, open response, ranking)
- **Target Demographics**: Filter backstories by age, gender, political affiliation, education level
- **Upload Backstories**: Contribute your own backstories (public or private)
- **Run & Analyze**: Execute surveys using LLMs and view results with visualizations and CSV export

## Project Structure

```
virtual-personas-arena/
├── frontend/           # React + TypeScript + Vite
│   ├── src/
│   │   ├── components/ # UI components (shadcn/ui based)
│   │   ├── pages/      # Route pages
│   │   ├── hooks/      # Custom React hooks
│   │   ├── lib/        # Utilities and Supabase client
│   │   ├── contexts/   # React contexts (Auth)
│   │   └── types/      # TypeScript types
│   └── ...
├── worker/             # Python worker service
│   ├── consumer.py     # RabbitMQ task consumer
│   ├── llm_runner.py   # LLM inference logic
│   └── config.py       # Configuration
└── supabase/
    └── migrations/     # Database schema
```

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.10+
- Supabase account
- RabbitMQ (or CloudAMQP)

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your Supabase credentials

# Start development server
npm run dev
```

### Database Setup

1. Create a new Supabase project
2. Go to SQL Editor and run the migration:
   ```bash
   cat supabase/migrations/001_initial_schema.sql
   ```
3. Copy your project URL and anon key to `frontend/.env`

### Worker Setup

```bash
cd worker

# Create virtual environment
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows

# Install dependencies
pip install -r requirements.txt

# Copy environment file
cp .env.example .env
# Edit .env with your credentials

# Start worker
python consumer.py
```

## Environment Variables

### Frontend (.env)

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Worker (.env)

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
RABBITMQ_URL=amqp://guest:guest@localhost:5672/
QUEUE_NAME=survey_tasks
DEFAULT_LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Supabase   │────▶│  PostgreSQL  │
│   (React)    │◀────│   (API)      │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
       │                                         │
       │ poll status                             │
       ▼                                         ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Progress   │     │   RabbitMQ   │◀────│   Backend    │
│   UI update  │     │   (Queue)    │     │   (enqueue)  │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │    Worker    │
                     │   (Python)   │
                     └──────────────┘
```

## Database Schema

### Tables

- **users**: User accounts with LLM configuration
- **backstories**: Shared pool of backstories with demographics
- **surveys**: User-created surveys with questions and results

See `supabase/migrations/001_initial_schema.sql` for full schema.

## Development

### Frontend

```bash
npm run dev      # Start dev server
npm run build    # Build for production
npm run preview  # Preview production build
```

### Worker

```bash
python consumer.py                    # Start worker
python consumer.py --enqueue <survey_id>  # Enqueue tasks for a survey
```

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Database**: Supabase (PostgreSQL)
- **Queue**: RabbitMQ
- **Worker**: Python with OpenAI/Anthropic SDK

## Research Context

This platform is part of the Virtual Personas research at UC Berkeley's BAIR lab, exploring how LLMs can be conditioned with backstories to simulate individual human perspectives.

Related codebases:
- [Anthology](../anthology/) - Original 2024 paper implementation
- [Alterity](../alterity-private-main/) - Follow-up research on belief consistency
