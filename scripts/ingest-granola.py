#!/usr/bin/env python3
"""
Granola transcript ingestion script for eloso-bisque.

Fetches meeting notes from the Granola API (https://public-api.granola.ai)
and saves them to two destinations:

  1. SQLite DB:  ~/lobster-workspace/data/transcripts.db
  2. Obsidian:   ~/lobster-workspace/obsidian-vault/granola/YYYY/MM/

Uses the existing Lobster Granola integration from ~/lobster/src/.

State file: ~/lobster-workspace/data/granola-sync-state.json
  (shared with the scheduled granola-sync job to avoid duplicate fetches)

Usage:
  # Incremental (only new notes since last sync):
  python3 scripts/ingest-granola.py

  # Full backfill (all notes, ignore state):
  python3 scripts/ingest-granola.py --backfill

  # Dry run (fetch + print, no writes):
  python3 scripts/ingest-granola.py --dry-run

  # Show what's in the local DB:
  python3 scripts/ingest-granola.py --list

Exit codes:
  0  success
  1  partial failure (some notes had errors)
  2  fatal / configuration error
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Bootstrap: ensure ~/lobster/src is importable
# ---------------------------------------------------------------------------

_LOBSTER_SRC = Path.home() / "lobster" / "src"
if str(_LOBSTER_SRC) not in sys.path:
    sys.path.insert(0, str(_LOBSTER_SRC))


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_WORKSPACE = Path(os.environ.get("LOBSTER_WORKSPACE", Path.home() / "lobster-workspace"))
_DB_PATH = _WORKSPACE / "data" / "transcripts.db"
_STATE_FILE = _WORKSPACE / "data" / "granola-sync-state.json"
_VAULT_PATH = Path(os.environ.get("GRANOLA_VAULT_PATH", str(_WORKSPACE / "obsidian-vault")))


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log = logging.getLogger("ingest-granola")


def _setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%SZ",
        stream=sys.stderr,
    )


# ---------------------------------------------------------------------------
# Config loader
# ---------------------------------------------------------------------------

def _load_config_env() -> None:
    """Source ~/lobster-config/config.env into os.environ (skip if already set)."""
    config_dir = Path(os.environ.get("LOBSTER_CONFIG_DIR", str(Path.home() / "lobster-config")))
    for env_file in [config_dir / "config.env", config_dir / "global.env"]:
        if not env_file.exists():
            continue
        try:
            with env_file.open(encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    key = key.strip()
                    value = value.strip()
                    if key and key not in os.environ:
                        os.environ[key] = value
        except OSError as exc:
            log.warning("Could not load %s: %s", env_file, exc)


# ---------------------------------------------------------------------------
# SQLite DB setup
# ---------------------------------------------------------------------------

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS transcripts (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    ingested_at    TEXT NOT NULL,
    owner_name     TEXT DEFAULT '',
    owner_email    TEXT DEFAULT '',
    attendees      TEXT DEFAULT '[]',  -- JSON array [{name, email}]
    summary        TEXT DEFAULT '',    -- summary_markdown (may be empty)
    transcript     TEXT DEFAULT '',    -- formatted transcript text (may be empty)
    duration_min   INTEGER,
    calendar_title TEXT DEFAULT '',
    scheduled_start TEXT DEFAULT '',
    scheduled_end  TEXT DEFAULT '',
    vault_path     TEXT DEFAULT '',    -- relative path in Obsidian vault
    source         TEXT DEFAULT 'granola',
    raw_json       TEXT DEFAULT ''     -- full raw API response for future use
);

CREATE INDEX IF NOT EXISTS idx_transcripts_created_at
    ON transcripts(created_at);

CREATE INDEX IF NOT EXISTS idx_transcripts_owner_email
    ON transcripts(owner_email);
"""


def init_db(db_path: Path) -> sqlite3.Connection:
    """Create DB and schema if not present, return open connection."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.executescript(_CREATE_TABLE_SQL)
    conn.commit()
    return conn


def get_existing_ids(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT id FROM transcripts")}


def upsert_transcript(conn: sqlite3.Connection, note, vault_rel_path: str) -> bool:
    """
    Insert or replace a transcript record. Returns True if it was new.

    Args:
        note: GranolaNote dataclass from the Lobster integration.
        vault_rel_path: Relative path in the Obsidian vault (e.g. granola/2026/03/foo.md)
    """
    from integrations.granola.serializer import _format_transcript_segments

    attendees_json = json.dumps([
        {"name": a.name, "email": a.email}
        for a in note.attendees
    ])

    summary = note.summary_markdown or note.summary_text or ""
    transcript_text = _format_transcript_segments(note.transcript) if note.transcript else ""

    cal = note.calendar_event
    duration_min = None
    calendar_title = ""
    scheduled_start = ""
    scheduled_end = ""
    if cal:
        calendar_title = cal.event_title or ""
        if cal.scheduled_start_time and cal.scheduled_end_time:
            delta = cal.scheduled_end_time - cal.scheduled_start_time
            duration_min = max(0, int(delta.total_seconds() / 60))
        if cal.scheduled_start_time:
            scheduled_start = cal.scheduled_start_time.strftime("%Y-%m-%dT%H:%M:%SZ")
        if cal.scheduled_end_time:
            scheduled_end = cal.scheduled_end_time.strftime("%Y-%m-%dT%H:%M:%SZ")

    existing = conn.execute(
        "SELECT id FROM transcripts WHERE id = ?", (note.id,)
    ).fetchone()

    conn.execute("""
        INSERT OR REPLACE INTO transcripts
          (id, title, created_at, updated_at, ingested_at,
           owner_name, owner_email, attendees, summary, transcript,
           duration_min, calendar_title, scheduled_start, scheduled_end,
           vault_path, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'granola')
    """, (
        note.id,
        note.title,
        note.created_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        note.updated_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        note.owner.name,
        note.owner.email,
        attendees_json,
        summary,
        transcript_text,
        duration_min,
        calendar_title,
        scheduled_start,
        scheduled_end,
        vault_rel_path,
    ))
    conn.commit()
    return existing is None  # True = new record


# ---------------------------------------------------------------------------
# State management (shared with the scheduled granola-sync job)
# ---------------------------------------------------------------------------

def _load_sync_state() -> dict:
    if _STATE_FILE.exists():
        try:
            with _STATE_FILE.open(encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as exc:
            log.warning("Could not read state file: %s — starting fresh", exc)
    return {"last_sync_at": None, "total_synced": 0, "last_run_at": None}


def _save_sync_state(state: dict) -> None:
    _STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with _STATE_FILE.open("w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    log.debug("Saved sync state to %s", _STATE_FILE)


# ---------------------------------------------------------------------------
# Main ingest logic
# ---------------------------------------------------------------------------

def ingest(
    backfill: bool = False,
    dry_run: bool = False,
    verbose: bool = False,
) -> int:
    """
    Run the ingestion pipeline. Returns exit code (0=ok, 1=partial, 2=fatal).
    """
    _setup_logging(verbose=verbose)
    _load_config_env()

    # Import after path setup and env loading
    try:
        from integrations.granola.client import (
            iter_all_notes,
            get_note,
            GranolaAuthError,
            GranolaAPIError,
        )
        from integrations.granola.serializer import note_vault_path
        from integrations.granola.vault_writer import write_note as vault_write_note
    except ImportError as exc:
        log.error(
            "Could not import Granola integration from %s: %s\n"
            "Make sure ~/lobster/src/ exists and dependencies are installed.",
            _LOBSTER_SRC, exc,
        )
        return 2

    api_key = os.environ.get("GRANOLA_API_KEY", "").strip()
    if not api_key:
        log.error("GRANOLA_API_KEY not set. Set it in ~/lobster-config/config.env.")
        return 2

    # Determine since timestamp
    state = _load_sync_state()
    since = None

    if not backfill:
        last_sync_str = state.get("last_sync_at")
        if last_sync_str:
            try:
                since = datetime.fromisoformat(last_sync_str.replace("Z", "+00:00"))
                log.info("Incremental sync since: %s", since.isoformat())
            except ValueError:
                log.warning("Could not parse last_sync_at %r — full sync", last_sync_str)
        else:
            log.info("No prior state — running full sync (all notes)")
    else:
        log.info("Backfill mode — fetching all notes")

    # Fetch notes from API
    run_start = datetime.now(timezone.utc)
    try:
        notes_summary = iter_all_notes(since=since, api_key=api_key)
    except GranolaAuthError:
        log.error("Granola authentication failed — check GRANOLA_API_KEY in config.env")
        return 2
    except GranolaAPIError as exc:
        log.error("Granola API error: %s", exc)
        return 1

    n_fetched = len(notes_summary)
    log.info("Fetched %d notes from Granola API", n_fetched)

    if n_fetched == 0:
        log.info("Nothing new to ingest.")
        state["last_run_at"] = run_start.isoformat()
        if not dry_run:
            _save_sync_state(state)
        return 0

    # Fetch full detail for each note (summary list lacks transcript/summary_markdown)
    log.info("Fetching full detail for %d notes...", n_fetched)
    notes_full = []
    for note in notes_summary:
        try:
            full = get_note(note.id, include_transcript=True, api_key=api_key)
            notes_full.append(full)
            log.debug("  Fetched detail: %s (%s)", full.title, full.id)
        except GranolaAPIError as exc:
            log.warning("  Could not fetch detail for %s: %s — using summary only", note.id, exc)
            notes_full.append(note)

    if dry_run:
        log.info("DRY RUN — skipping all writes")
        for note in notes_full:
            rel = note_vault_path(note)
            attendee_names = ", ".join(a.name for a in note.attendees if a.name) or "(none)"
            print(f"  [{note.created_at.date()}] {note.title}")
            print(f"    ID: {note.id}")
            print(f"    Vault: {rel}")
            print(f"    Attendees: {attendee_names}")
            print(f"    Summary: {len(note.summary_markdown)} chars")
            print(f"    Transcript: {len(note.transcript)} segments")
            print()
        print(f"Would ingest {n_fetched} notes (dry run — no writes).")
        return 0

    # Open DB
    conn = init_db(_DB_PATH)
    log.info("DB: %s", _DB_PATH)

    n_db_new = 0
    n_db_updated = 0
    n_vault_written = 0
    n_vault_skipped = 0
    n_errors = 0
    latest_updated_at = None

    for note in notes_full:
        try:
            # Write to Obsidian vault
            rel = note_vault_path(note)
            was_written, detail = vault_write_note(note, vault_path=_VAULT_PATH)
            if was_written:
                n_vault_written += 1
                log.info("  Vault: wrote %s → %s", note.id, rel)
            else:
                n_vault_skipped += 1
                log.debug("  Vault: unchanged %s", note.id)

            # Write to SQLite
            is_new = upsert_transcript(conn, note, vault_rel_path=rel)
            if is_new:
                n_db_new += 1
            else:
                n_db_updated += 1

            # Track latest updated_at for state advancement
            if latest_updated_at is None or note.updated_at > latest_updated_at:
                latest_updated_at = note.updated_at

        except Exception as exc:
            log.error("  Error processing note %s (%s): %s", note.id, note.title, exc)
            n_errors += 1

    conn.close()

    # Update sync state
    if latest_updated_at:
        state["last_sync_at"] = latest_updated_at.astimezone(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%S.000Z"
        )
    state["last_run_at"] = run_start.isoformat()
    state["total_synced"] = state.get("total_synced", 0) + n_db_new
    _save_sync_state(state)

    # Git commit the vault
    if n_vault_written > 0:
        try:
            from integrations.granola.vault_writer import _git_commit, _ensure_git_repo
            _ensure_git_repo(_VAULT_PATH)
            ts = run_start.strftime("%Y-%m-%dT%H:%M:%SZ")
            committed = _git_commit(_VAULT_PATH, n_vault_written, ts)
            if committed:
                log.info("Git committed %d vault changes", n_vault_written)
        except Exception as exc:
            log.warning("Git commit failed (non-fatal): %s", exc)

    # Summary
    log.info(
        "Done — DB: %d new, %d updated | Vault: %d written, %d skipped | Errors: %d",
        n_db_new, n_db_updated, n_vault_written, n_vault_skipped, n_errors,
    )
    print(json.dumps({
        "status": "success" if n_errors == 0 else "partial",
        "notes_fetched": n_fetched,
        "db_new": n_db_new,
        "db_updated": n_db_updated,
        "vault_written": n_vault_written,
        "vault_skipped": n_vault_skipped,
        "errors": n_errors,
        "db_path": str(_DB_PATH),
        "vault_path": str(_VAULT_PATH),
        "last_sync_at": state.get("last_sync_at"),
    }, indent=2))

    return 0 if n_errors == 0 else 1


# ---------------------------------------------------------------------------
# List command
# ---------------------------------------------------------------------------

def list_transcripts(limit: int = 20) -> int:
    """Print a summary of transcripts already in the local DB."""
    _setup_logging()
    if not _DB_PATH.exists():
        print(f"DB not found at {_DB_PATH}")
        print("Run without --list to ingest first.")
        return 2

    conn = sqlite3.connect(str(_DB_PATH))
    rows = conn.execute(
        """
        SELECT id, title, created_at, owner_name, duration_min, vault_path
        FROM transcripts
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) FROM transcripts").fetchone()[0]
    conn.close()

    if not rows:
        print("No transcripts in DB yet.")
        return 0

    print(f"Transcripts in {_DB_PATH} ({total} total, showing {len(rows)}):\n")
    for row in rows:
        id_, title, created_at, owner, duration, vault = row
        dur_str = f"{duration}min" if duration else "?"
        print(f"  {created_at[:10]}  [{dur_str:>6}]  {title[:55]:<55}  ({owner})")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ingest Granola meeting notes into transcripts.db and Obsidian vault",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="Ignore last-sync state and fetch ALL notes (full backfill)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and show notes without writing anything",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Show transcripts already in the local DB",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable debug logging",
    )
    args = parser.parse_args()

    if args.list:
        sys.exit(list_transcripts())

    sys.exit(ingest(
        backfill=args.backfill,
        dry_run=args.dry_run,
        verbose=args.verbose,
    ))


if __name__ == "__main__":
    main()
