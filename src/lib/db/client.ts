/**
 * SQLite client for bisque-booking.
 * Uses better-sqlite3 (synchronous, server-side only).
 * The DB file path is controlled by BOOKING_DB_PATH env var;
 * defaults to /tmp/bisque-booking.db for dev / Vercel ephemeral fs.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let _db: Database.Database | null = null;

function getDbPath(): string {
  return process.env.BOOKING_DB_PATH ?? '/tmp/bisque-booking.db';
}

function readSchema(): string {
  const schemaPath = path.join(process.cwd(), 'src/lib/db/schema.sql');
  return fs.readFileSync(schemaPath, 'utf-8');
}

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = getDbPath();
  _db = new Database(dbPath);

  // Enable WAL for better concurrency
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Run schema (idempotent — uses CREATE IF NOT EXISTS)
  const schema = readSchema();
  _db.exec(schema);

  return _db;
}

/** Close and reset the connection (used in tests). */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
