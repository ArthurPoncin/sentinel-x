import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { HistoryRecord } from './contract.js'

// Both ends included, ISO 8601 UTC.
export interface TimeRange {
  from: string
  to: string
}

// Telemetry and Alert history: what the time-scrubber replays and the predictive model trains on.
export interface HistoryRepository {
  append(record: HistoryRecord): void
  // The records whose ts falls in the range, oldest first; records sharing a ts in the order
  // they were appended.
  query(range: TimeRange): HistoryRecord[]
}

// Orders and filters by instant, not by text: "…:00Z" and "…:00.500Z" do not sort as strings do.
function instant(ts: string): number {
  return Date.parse(ts)
}

// Keeps everything in the process, gone with it: for tests and for a run without a disk.
export function createMemoryHistory(): HistoryRepository {
  const records: { at: number; record: HistoryRecord }[] = []

  return {
    append(record) {
      // A copy in and a copy out, like a record that goes through a database.
      records.push({ at: instant(record.payload.ts), record: structuredClone(record) })
    },
    query(range) {
      const [from, to] = [instant(range.from), instant(range.to)]
      return records
        .filter(({ at }) => from <= at && at <= to)
        .sort((a, b) => a.at - b.at)
        .map(({ record }) => structuredClone(record))
    },
  }
}

// Keeps the history in an SQLite file, created along with its directory if missing.
export function openSqliteHistory(file: string): HistoryRepository & { close(): void } {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
    -- Lets a reader (the predictive model) query while the api writes; fewer syncs on the SD card.
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY,
      -- ts of the record, in milliseconds since the epoch.
      at INTEGER NOT NULL,
      type TEXT NOT NULL,
      sentinel TEXT NOT NULL,
      -- The whole frame, as JSON.
      record TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS history_by_time ON history (at, id);
  `)
  const insert = db.prepare('INSERT INTO history (at, type, sentinel, record) VALUES (?, ?, ?, ?)')
  const select = db.prepare('SELECT record FROM history WHERE at BETWEEN ? AND ? ORDER BY at, id')

  return {
    append(record) {
      insert.run(instant(record.payload.ts), record.type, record.payload.sentinel, JSON.stringify(record))
    },
    query(range) {
      return select
        .all(instant(range.from), instant(range.to))
        .map((row) => JSON.parse(String(row.record)) as HistoryRecord)
    },
    close() {
      db.close()
    },
  }
}

// The live feed comes first: a record the history cannot take is logged, and the feed carries on.
export function keep(history: HistoryRepository, record: HistoryRecord): void {
  try {
    history.append(record)
  } catch (error) {
    console.warn(`History: lost a ${record.type} of ${record.payload.ts}: ${(error as Error).message}`)
  }
}
