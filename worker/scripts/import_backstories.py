#!/usr/bin/env python3
"""
Import HuggingFace backstory datasets into Supabase.

Supports two datasets:
- anthology: SuhongMoon/anthology_backstory (11,400 rows)
- alterity: SuhongMoon/alterity_backstory (41,100 rows)

Usage:
    python scripts/import_backstories.py --dataset anthology
    python scripts/import_backstories.py --dataset alterity --batch-size 200
    python scripts/import_backstories.py --dataset anthology --dry-run --limit 10
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from typing import Generator, Optional

from datasets import load_dataset
from dotenv import load_dotenv
from supabase import create_client, Client

# Dataset configurations
DATASETS = {
    "anthology": {
        "hf_path": "SuhongMoon/anthology_backstory",
        "source_type": "anthology",
    },
    "alterity": {
        "hf_path": "SuhongMoon/alterity_backstory",
        "source_type": "alterity",
    },
}


def get_supabase_client() -> Client:
    """Create Supabase client from environment variables."""
    load_dotenv()

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")

    if not url or not key:
        print("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")
        sys.exit(1)

    return create_client(url, key)


def sanitize_text(text: str) -> str:
    """Remove characters that PostgreSQL doesn't support."""
    # PostgreSQL text fields don't support null characters
    return text.replace("\u0000", "")


def compute_text_hash(text: str) -> str:
    """Compute SHA-256 hash of text for deduplication."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_hf_dataset(dataset_name: str, limit: Optional[int] = None) -> Generator[dict, None, None]:
    """Load dataset from HuggingFace and yield rows."""
    config = DATASETS[dataset_name]
    print(f"Loading dataset: {config['hf_path']}")

    dataset = load_dataset(config["hf_path"], split="train")

    count = 0
    for row in dataset:
        if limit and count >= limit:
            break

        text = row.get("text", "")
        if not text or not text.strip():
            continue

        # Sanitize and clean the text
        clean_text = sanitize_text(text.strip())

        yield {
            "backstory_text": clean_text,
            "contributor_id": None,
            "source_type": config["source_type"],
            "transcript": None,
            "demographics": {},
            "is_public": True,
            "text_hash": compute_text_hash(clean_text),
        }
        count += 1


def get_existing_hashes(supabase: Client, source_type: str) -> set[str]:
    """Get all existing text hashes for a source type to prevent duplicates."""
    print(f"Checking for existing {source_type} backstories...")

    # Query all backstories with this source type
    # We use pagination since there could be many
    all_hashes = set()
    page_size = 1000
    offset = 0

    while True:
        response = (
            supabase.table("backstories")
            .select("backstory_text")
            .eq("source_type", source_type)
            .range(offset, offset + page_size - 1)
            .execute()
        )

        if not response.data:
            break

        for row in response.data:
            text_hash = compute_text_hash(row["backstory_text"])
            all_hashes.add(text_hash)

        offset += page_size

        if len(response.data) < page_size:
            break

    print(f"Found {len(all_hashes)} existing {source_type} backstories")
    return all_hashes


def batch_insert(
    supabase: Client,
    rows: list[dict],
    dry_run: bool = False,
) -> int:
    """Insert a batch of rows into Supabase."""
    if dry_run:
        return len(rows)

    # Remove text_hash before inserting (it's just for dedup)
    insert_rows = [
        {k: v for k, v in row.items() if k != "text_hash"}
        for row in rows
    ]

    response = supabase.table("backstories").insert(insert_rows).execute()
    return len(response.data)


def import_dataset(
    dataset_name: str,
    dry_run: bool = False,
    batch_size: int = 100,
    limit: Optional[int] = None,
) -> None:
    """Import a dataset into Supabase."""
    if dataset_name not in DATASETS:
        print(f"Error: Unknown dataset '{dataset_name}'")
        print(f"Available datasets: {', '.join(DATASETS.keys())}")
        sys.exit(1)

    supabase = get_supabase_client()
    source_type = DATASETS[dataset_name]["source_type"]

    # Get existing hashes to prevent duplicates
    existing_hashes = get_existing_hashes(supabase, source_type)

    batch = []
    total_inserted = 0
    total_skipped = 0
    total_processed = 0

    print(f"Importing {dataset_name} dataset...")
    if dry_run:
        print("DRY RUN - no data will be inserted")
    if limit:
        print(f"Limited to {limit} rows")

    for row in load_hf_dataset(dataset_name, limit=limit):
        total_processed += 1

        # Skip if already exists
        if row["text_hash"] in existing_hashes:
            total_skipped += 1
            continue

        # Add to existing hashes to prevent duplicates within this run
        existing_hashes.add(row["text_hash"])
        batch.append(row)

        # Insert when batch is full
        if len(batch) >= batch_size:
            inserted = batch_insert(supabase, batch, dry_run=dry_run)
            total_inserted += inserted
            print(f"  Inserted {total_inserted} rows...")
            batch = []

    # Insert remaining rows
    if batch:
        inserted = batch_insert(supabase, batch, dry_run=dry_run)
        total_inserted += inserted

    print()
    print("=" * 50)
    print(f"Import complete: {dataset_name}")
    print(f"  Total processed: {total_processed}")
    print(f"  Inserted: {total_inserted}")
    print(f"  Skipped (duplicates): {total_skipped}")
    if dry_run:
        print("  (DRY RUN - no actual changes made)")
    print("=" * 50)


def main():
    parser = argparse.ArgumentParser(
        description="Import HuggingFace backstory datasets into Supabase"
    )
    parser.add_argument(
        "--dataset",
        required=True,
        choices=list(DATASETS.keys()),
        help="Dataset to import (anthology or alterity)",
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
        help="Limit number of rows to import (for testing)",
    )

    args = parser.parse_args()

    import_dataset(
        dataset_name=args.dataset,
        dry_run=args.dry_run,
        batch_size=args.batch_size,
        limit=args.limit,
    )


if __name__ == "__main__":
    main()
