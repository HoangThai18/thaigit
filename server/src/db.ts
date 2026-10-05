// SQLite (node:sqlite, built into Node 24 — no native dependency needed). WAL; migrations only ADD, versioned in
// `schema_meta.schema_version`. Old code meeting a newer schema refuses to start (avoiding writes in the wrong shape).

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const MIGRATIONS: readonly string[] = [
  // 1 — AI + analytics + downloads. No column holds diff/message content, IPs or raw ids.
  `
  CREATE TABLE ai_installs (
    id_hash TEXT PRIMARY KEY,
    created_day TEXT NOT NULL,
    last_ok_day TEXT,
    ok_days INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE ai_blocked (
    id_hash TEXT PRIMARY KEY,
    reason TEXT,
    ts INTEGER NOT NULL
  );
  CREATE TABLE ai_quota (
    day TEXT NOT NULL,
    id_hash TEXT NOT NULL,
    feature TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (day, id_hash, feature)
  );
  CREATE TABLE ai_requests (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    day TEXT NOT NULL,
    feature TEXT NOT NULL,
    app_version TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    queue_ms INTEGER,
    ttft_ms INTEGER,
    latency_ms INTEGER,
    status TEXT NOT NULL,
    error_code TEXT
  );
  CREATE INDEX ai_requests_day ON ai_requests(day);
  CREATE TABLE daily_active (
    day TEXT NOT NULL,
    tel_hash TEXT NOT NULL,
    platform TEXT NOT NULL,
    arch TEXT NOT NULL,
    app_version TEXT NOT NULL,
    PRIMARY KEY (day, tel_hash)
  );
  CREATE TABLE daily_counts (
    day TEXT NOT NULL,
    platform TEXT NOT NULL,
    app_version TEXT NOT NULL,
    dau INTEGER NOT NULL,
    PRIMARY KEY (day, platform, app_version)
  );
  CREATE TABLE downloads (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    day TEXT NOT NULL,
    asset TEXT NOT NULL,
    version TEXT,
    ua_family TEXT NOT NULL
  );
  CREATE INDEX downloads_day ON downloads(day);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export class SchemaTooNewError extends Error {}

function currentVersion(db: Db): number {
  const row = db.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get() as
    { value: string } | undefined;
  return row === undefined ? 0 : Number(row.value);
}

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const version = currentVersion(db);
  if (version > SCHEMA_VERSION) {
    db.close();
    throw new SchemaTooNewError(`DB có schema ${version}, code này chỉ biết tới ${SCHEMA_VERSION}`);
  }
  for (let next = version; next < SCHEMA_VERSION; next += 1) {
    transaction(db, () => {
      db.exec(MIGRATIONS[next] ?? '');
      db.prepare(
        `INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(String(next + 1));
    });
  }
  return db;
}

/** Run `work` inside a transaction (BEGIN IMMEDIATE: takes the write lock up front so two requests cannot interleave read-then-write). */
export function transaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Check that the database is still readable (for /healthz). */
export function pingDatabase(db: Db): boolean {
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}
