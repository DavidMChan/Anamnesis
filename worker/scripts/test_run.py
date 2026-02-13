#!/usr/bin/env python3
"""
Test script to create a survey run with limited backstories.

Usage:
    python scripts/test_run.py --survey-id <UUID> --limit 10
    python scripts/test_run.py --survey-id <UUID> --limit 100
    python scripts/test_run.py --list-surveys  # List available surveys
"""
import argparse
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import get_config
from src.db import DatabaseClient


def list_surveys(db: DatabaseClient):
    """List all surveys in the database."""
    result = db.client.table("surveys").select("id, name, status, questions").execute()

    if not result.data:
        print("No surveys found.")
        return

    print("\n=== Available Surveys ===\n")
    for survey in result.data:
        q_count = len(survey.get("questions", []))
        print(f"  ID: {survey['id']}")
        print(f"  Name: {survey.get('name') or 'Untitled'}")
        print(f"  Status: {survey['status']}")
        print(f"  Questions: {q_count}")
        print()


def list_backstories(db: DatabaseClient, limit: int = 10):
    """Show how many backstories are available."""
    # Count total
    result = db.client.table("backstories").select("id", count="exact").eq("is_public", True).execute()
    total = result.count if result.count else len(result.data or [])

    print(f"\n=== Backstories ===")
    print(f"  Total public backstories: {total}")
    print(f"  Will use: {min(limit, total)}")
    print()


def create_test_run(db: DatabaseClient, survey_id: str, limit: int):
    """Create a test survey run with limited backstories."""

    # Verify survey exists
    survey = db.client.table("surveys").select("*").eq("id", survey_id).single().execute()
    if not survey.data:
        print(f"Error: Survey {survey_id} not found")
        return None

    print(f"\n=== Creating Test Run ===")
    print(f"  Survey: {survey.data.get('name') or 'Untitled'}")
    print(f"  Questions: {len(survey.data.get('questions', []))}")

    # Get limited backstories
    result = db.client.table("backstories").select("id").eq("is_public", True).limit(limit).execute()
    backstory_ids = [row["id"] for row in (result.data or [])]

    if not backstory_ids:
        print("Error: No backstories found")
        return None

    print(f"  Backstories: {len(backstory_ids)}")

    # Create the run
    llm_config = {
        "provider": os.environ.get("LLM_PROVIDER", "openrouter"),
        "model": os.environ.get("OPENROUTER_MODEL", "anthropic/claude-3-haiku"),
    }

    run_result = db.client.table("survey_runs").insert({
        "survey_id": survey_id,
        "status": "pending",
        "total_tasks": len(backstory_ids),
        "completed_tasks": 0,
        "failed_tasks": 0,
        "results": {},
        "error_log": [],
        "llm_config": llm_config,
    }).execute()

    run_id = run_result.data[0]["id"]
    print(f"  Run ID: {run_id}")

    # Create tasks
    tasks = [
        {"survey_run_id": run_id, "backstory_id": bid, "status": "pending", "attempts": 0}
        for bid in backstory_ids
    ]
    db.client.table("survey_tasks").insert(tasks).execute()

    print(f"\n✅ Created run with {len(tasks)} tasks")
    print(f"\nNow start the dispatcher and worker:")
    print(f"  Terminal 1: ./venv/bin/python -m src.dispatcher")
    print(f"  Terminal 2: ./venv/bin/python main.py")

    return run_id


def check_run_status(db: DatabaseClient, run_id: str):
    """Check the status of a run."""
    run = db.client.table("survey_runs").select("*").eq("id", run_id).single().execute()

    if not run.data:
        print(f"Run {run_id} not found")
        return

    r = run.data
    print(f"\n=== Run Status ===")
    print(f"  ID: {r['id']}")
    print(f"  Status: {r['status']}")
    print(f"  Progress: {r['completed_tasks']}/{r['total_tasks']} completed, {r['failed_tasks']} failed")

    if r['error_log']:
        print(f"  Errors: {len(r['error_log'])}")
        for err in r['error_log'][:3]:  # Show first 3 errors
            print(f"    - {err.get('error', 'Unknown error')[:80]}")


def main():
    parser = argparse.ArgumentParser(description="Test survey run creation")
    parser.add_argument("--list-surveys", action="store_true", help="List available surveys")
    parser.add_argument("--list-backstories", action="store_true", help="Count backstories")
    parser.add_argument("--survey-id", type=str, help="Survey ID to run")
    parser.add_argument("--limit", type=int, default=10, help="Max backstories to process (default: 10)")
    parser.add_argument("--check", type=str, help="Check status of a run by ID")

    args = parser.parse_args()

    # Load config and connect to DB
    config = get_config()
    db = DatabaseClient(config.supabase)

    if args.list_surveys:
        list_surveys(db)
    elif args.list_backstories:
        list_backstories(db, args.limit)
    elif args.check:
        check_run_status(db, args.check)
    elif args.survey_id:
        create_test_run(db, args.survey_id, args.limit)
    else:
        parser.print_help()
        print("\n\nExamples:")
        print("  python scripts/test_run.py --list-surveys")
        print("  python scripts/test_run.py --list-backstories --limit 100")
        print("  python scripts/test_run.py --survey-id <UUID> --limit 10")
        print("  python scripts/test_run.py --check <RUN_ID>")


if __name__ == "__main__":
    main()
