import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

/** Path to the SQLite file. Override via DATABASE_PATH env var for Docker volume mounts. */
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "work-share.db");

// Ensure the data directory exists before opening the database file.
const dbDir = path.dirname(DATABASE_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DATABASE_PATH);

// Enable WAL mode for better concurrent read performance.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/**
 * Creates all tables if they do not already exist.
 * Schema is append-only; existing columns are never dropped.
 */
db.exec(`
    -- Users
    CREATE TABLE IF NOT EXISTS users (
        username         TEXT PRIMARY KEY,
        full_name        TEXT NOT NULL,
        email            TEXT NOT NULL UNIQUE,
        password_hash    TEXT NOT NULL,
        created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- SSH keys (multiple per user)
    CREATE TABLE IF NOT EXISTS ssh_keys (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        username         TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        label            TEXT NOT NULL,
        public_key       TEXT NOT NULL,
        created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- Teams
    CREATE TABLE IF NOT EXISTS teams (
        team_name        TEXT PRIMARY KEY,
        owner_username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- Team memberships (pending invitation OR active member)
    -- status: 'pending' | 'active'
    CREATE TABLE IF NOT EXISTS team_members (
        team_name        TEXT NOT NULL REFERENCES teams(team_name) ON DELETE CASCADE,
        username         TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        status           TEXT NOT NULL DEFAULT 'pending',
        invited_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        joined_at        TEXT,
        PRIMARY KEY (team_name, username)
    );

    -- Per-user sharing enable/disable timestamps per team.
    -- When sharing_enabled is 0, patches after disabled_at are hidden from teammates.
    CREATE TABLE IF NOT EXISTS team_sharing (
        team_name        TEXT NOT NULL REFERENCES teams(team_name) ON DELETE CASCADE,
        username         TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        sharing_enabled  INTEGER NOT NULL DEFAULT 1,
        disabled_at      TEXT,
        PRIMARY KEY (team_name, username)
    );

    -- Session tokens (for plugin JWT-style auth)
    CREATE TABLE IF NOT EXISTS sessions (
        token_id         TEXT PRIMARY KEY,
        username         TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        expires_at       TEXT NOT NULL,
        created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
`);

export default db;
