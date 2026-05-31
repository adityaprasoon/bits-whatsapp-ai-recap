import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';

export function initDatabase(dataDir: string): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'messages.db');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  logger.info(`Database initialized at ${dbPath}`);
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT,
      timestamp INTEGER NOT NULL,
      text TEXT,
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_group_time
      ON messages(group_id, timestamp);

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT,
      last_message_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS summary_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      summary_text TEXT,
      messages_from INTEGER,
      messages_to INTEGER,
      message_count INTEGER,
      model_used TEXT,
      status TEXT,
      created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
    );
  `);
}
