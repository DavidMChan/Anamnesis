#!/usr/bin/env python3
"""
Import backstories with demographics from a JSONL file into Supabase.

Streams the file line-by-line to handle large files (2GB+).
Deduplicates by vuid (takes first occurrence).

Usage:
    python scripts/import_jsonl_backstories.py --file path/to/file.jsonl
    python scripts/import_jsonl_backstories.py --file path/to/file.jsonl --dry-run --limit 10
    python scripts/import_jsonl_backstories.py --file path/to/file.jsonl --clear-alterity
    python scripts/import_jsonl_backstories.py --file path/to/file.jsonl --clear --batch-size 200
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, Generator, List, Optional

# Demographic dimensions to extract from JSONL records
DEMO_FIELDS = [
    "c_age",
    "c_gender",
    "c_education",
    "c_income",
    "c_race",
    "c_religion",
    "c_region",
    "c_party",
    "c_democratic_strength",
    "c_republican_strength",
    "c_independent_leaning",
]


def get_supabase_client():
    """Create Supabase client from environment variables."""
    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv()

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")

    if not url or not key:
        print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")
        sys.exit(1)

    return create_client(url, key)


def sanitize_text(text: str) -> str:
    """Remove characters that PostgreSQL doesn't support."""
    return text.replace("\u0000", "")


def parse_demographics(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract demographics from a JSONL record into the target format.

    Returns:
        Dict like {"c_age": {"value": "45-54", "distribution": {"18-24": 0.0, ...}}, ...}
    """
    demographics: Dict[str, Any] = {}

    for field in DEMO_FIELDS:
        options = record.get(f"{field}_question_options")
        top_idx = record.get(f"{field}_top_choice")
        choices = record.get(f"{field}_choices")

        if options is None or top_idx is None:
            continue

        # Get the text value for top_choice
        value = None
        if isinstance(top_idx, int) and 0 <= top_idx < len(options):
            value = options[top_idx]

        # Build distribution mapping option text -> probability
        distribution: Dict[str, float] = {}
        if choices and isinstance(choices, dict):
            for idx_str, prob in choices.items():
                try:
                    idx = int(idx_str)
                except (ValueError, TypeError):
                    continue
                if 0 <= idx < len(options):
                    distribution[options[idx]] = prob

        demographics[field] = {"value": value, "distribution": distribution}

    return demographics


def stream_jsonl(
    file_path: str, limit: Optional[int] = None
) -> Generator[Dict[str, Any], None, None]:
    """
    Stream JSONL records, deduplicating by vuid (first occurrence wins).

    Args:
        file_path: Path to JSONL file
        limit: Max records to yield (after dedup)

    Yields:
        Parsed row dicts ready for DB insertion
    """
    seen_vuids: set[str] = set()
    yielded = 0

    with open(file_path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            if limit and yielded >= limit:
                break

            line = line.strip()
            if not line:
                continue

            try:
                record = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"  Warning: skipping line {line_num} (invalid JSON): {e}")
                continue

            vuid = record.get("virtual_subject_vuid")
            if not vuid:
                print(f"  Warning: skipping line {line_num} (no vuid)")
                continue

            # Deduplicate by vuid
            if vuid in seen_vuids:
                continue
            seen_vuids.add(vuid)

            backstory_text = record.get("virtual_subject_backstory", "")
            if not backstory_text or not backstory_text.strip():
                print(f"  Warning: skipping vuid {vuid} (empty backstory)")
                continue

            demographics = parse_demographics(record)

            yield {
                "vuid": vuid,
                "backstory_text": sanitize_text(backstory_text.strip()),
                "contributor_id": None,
                "source_type": "alterity",
                "transcript": None,
                "demographics": demographics,
                "is_public": True,
            }
            yielded += 1

            if yielded % 5000 == 0:
                print(f"  Parsed {yielded} records...")


def clear_all_backstories(supabase) -> None:
    """Delete all backstories and related data (respecting FK order)."""
    print("Clearing ALL existing data...")

    # FK order: survey_tasks -> survey_runs -> backstories
    print("  Deleting survey_tasks...")
    supabase.table("survey_tasks").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    print("  Deleting survey_runs...")
    supabase.table("survey_runs").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    print("  Deleting backstories...")
    supabase.table("backstories").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    print("  Done clearing.")


def clear_alterity_backstories(supabase) -> None:
    """Delete only alterity backstories and their related survey data."""
    print("Clearing alterity backstories...")

    # Get all alterity backstory IDs first
    print("  Finding alterity backstory IDs...")
    all_ids = []
    page_size = 1000
    offset = 0
    while True:
        result = (
            supabase.table("backstories")
            .select("id")
            .eq("source_type", "alterity")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not result.data:
            break
        all_ids.extend(row["id"] for row in result.data)
        if len(result.data) < page_size:
            break
        offset += page_size

    print(f"  Found {len(all_ids)} alterity backstories")

    if not all_ids:
        print("  Nothing to clear.")
        return

    # Delete survey_tasks referencing these backstories (in batches)
    print("  Deleting related survey_tasks...")
    for i in range(0, len(all_ids), 100):
        batch_ids = all_ids[i:i + 100]
        supabase.table("survey_tasks").delete().in_("backstory_id", batch_ids).execute()

    # Delete the backstories themselves
    print("  Deleting alterity backstories...")
    for i in range(0, len(all_ids), 100):
        batch_ids = all_ids[i:i + 100]
        supabase.table("backstories").delete().in_("id", batch_ids).execute()

    print(f"  Done clearing {len(all_ids)} alterity backstories.")


def batch_insert(supabase, rows: List[Dict[str, Any]], dry_run: bool = False) -> int:
    """Insert a batch of rows into Supabase."""
    if dry_run:
        return len(rows)

    response = supabase.table("backstories").insert(rows).execute()
    return len(response.data)


def import_jsonl(
    file_path: str,
    clear: bool = False,
    clear_alterity: bool = False,
    dry_run: bool = False,
    batch_size: int = 100,
    limit: Optional[int] = None,
) -> None:
    """Import JSONL backstories into Supabase."""
    if not os.path.exists(file_path):
        print(f"Error: File not found: {file_path}")
        sys.exit(1)

    supabase = get_supabase_client()

    if not dry_run:
        if clear:
            clear_all_backstories(supabase)
        elif clear_alterity:
            clear_alterity_backstories(supabase)

    print(f"Importing from: {file_path}")
    if dry_run:
        print("DRY RUN - no data will be inserted")
    if limit:
        print(f"Limited to {limit} records")

    batch: List[Dict[str, Any]] = []
    total_inserted = 0

    for row in stream_jsonl(file_path, limit=limit):
        batch.append(row)

        if len(batch) >= batch_size:
            inserted = batch_insert(supabase, batch, dry_run=dry_run)
            total_inserted += inserted
            print(f"  Inserted {total_inserted} rows...")
            batch = []

    # Insert remaining
    if batch:
        inserted = batch_insert(supabase, batch, dry_run=dry_run)
        total_inserted += inserted

    print()
    print("=" * 50)
    print("Import complete")
    print(f"  Total inserted: {total_inserted}")
    if dry_run:
        print("  (DRY RUN - no actual changes made)")
    print("=" * 50)


def main():
    parser = argparse.ArgumentParser(
        description="Import JSONL backstories with demographics into Supabase"
    )
    parser.add_argument(
        "--file",
        required=True,
        help="Path to JSONL file",
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Delete ALL existing backstories before import (handles FK constraints)",
    )
    parser.add_argument(
        "--clear-alterity",
        action="store_true",
        help="Delete only alterity backstories before import (keeps anthology)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview without inserting data",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Number of rows to insert per batch (default: 100)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit number of records to import",
    )

    args = parser.parse_args()

    import_jsonl(
        file_path=args.file,
        clear=args.clear,
        clear_alterity=args.clear_alterity,
        dry_run=args.dry_run,
        batch_size=args.batch_size,
        limit=args.limit,
    )


if __name__ == "__main__":
    main()
