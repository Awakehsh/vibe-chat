import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const SCHEMA_VERSION = 1

export function openDatabase(dataDir: string): Database {
  mkdirSync(join(dataDir, "files"), { recursive: true })
  const db = new Database(join(dataDir, "vibe.db"), { create: true, strict: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA busy_timeout = 5000")
  migrate(db)
  return db
}

function migrate(db: Database): void {
  db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  const row = db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'").get()
  const current = row ? Number(row.value) : 0
  if (current >= SCHEMA_VERSION) return
  db.transaction(() => {
    if (current < 1) migrateV1(db)
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", [String(SCHEMA_VERSION)])
  })()
}

function migrateV1(db: Database): void {
  db.run(`CREATE TABLE users (
    user_id       TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    emoji         TEXT,
    status_text   TEXT,
    status_emoji  TEXT,
    created_at    TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL
  )`)
  db.run(`CREATE TABLE rooms (
    room_id          TEXT PRIMARY KEY,
    kind             TEXT NOT NULL CHECK (kind IN ('group','dm')),
    name             TEXT NOT NULL,
    emoji            TEXT,
    owner_id         TEXT NOT NULL,
    invite_token     TEXT UNIQUE,
    created_at       TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    last_seq         INTEGER NOT NULL DEFAULT 0
  )`)
  db.run(`CREATE TABLE members (
    room_id        TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
    user_id        TEXT NOT NULL REFERENCES users(user_id),
    joined_at      TEXT NOT NULL,
    last_read_seq  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (room_id, user_id)
  )`)
  db.run("CREATE INDEX members_by_user ON members(user_id)")
  db.run(`CREATE TABLE messages (
    msg_id      TEXT PRIMARY KEY,
    room_id     TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,
    author_id   TEXT NOT NULL,
    kind        TEXT NOT NULL,
    body        TEXT NOT NULL,
    meta        TEXT,
    reply_to    TEXT,
    attachments TEXT NOT NULL DEFAULT '[]',
    edited_at   TEXT,
    deleted_at  TEXT,
    created_at  TEXT NOT NULL,
    ciphertext  BLOB,
    UNIQUE (room_id, seq)
  )`)
  db.run(`CREATE TABLE reactions (
    msg_id   TEXT NOT NULL REFERENCES messages(msg_id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL,
    emoji    TEXT NOT NULL,
    PRIMARY KEY (msg_id, user_id, emoji)
  )`)
  db.run(`CREATE TABLE files (
    file_id      TEXT PRIMARY KEY,
    room_id      TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
    uploader_id  TEXT NOT NULL,
    name         TEXT NOT NULL,
    mime         TEXT NOT NULL,
    size         INTEGER NOT NULL,
    width        INTEGER,
    height       INTEGER,
    attached     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
  )`)
  db.run("CREATE INDEX files_by_room ON files(room_id)")
}
