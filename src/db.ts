import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data.sqlite");
let db: Database.Database;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    migrate(db);
  }
  return db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS date_nights (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        theme_id TEXT NOT NULL,
        date_iso TEXT,
        menu_json TEXT NOT NULL,
        blurb TEXT,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      date_night_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      recipient_email TEXT,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS selections (
      id TEXT PRIMARY KEY,
      invite_id TEXT NOT NULL UNIQUE,
      dinner_choice TEXT NOT NULL,
      activity_choice TEXT NOT NULL,
      mood_choice TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL
    );
  `);
}


