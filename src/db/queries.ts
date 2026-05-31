import Database from 'better-sqlite3';

export interface StoredMessage {
  id: string;
  group_id: string;
  sender_id: string;
  sender_name: string | null;
  timestamp: number;
  text: string | null;
}

export function insertMessage(db: Database.Database, msg: StoredMessage): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO messages (id, group_id, sender_id, sender_name, timestamp, text)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(msg.id, msg.group_id, msg.sender_id, msg.sender_name, msg.timestamp, msg.text);
}

export function getMessages(
  db: Database.Database,
  groupId: string,
  since: number,
  until?: number
): StoredMessage[] {
  const untilTs = until || Date.now();
  const stmt = db.prepare(`
    SELECT id, group_id, sender_id, sender_name, timestamp, text
    FROM messages
    WHERE group_id = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `);
  return stmt.all(groupId, since, untilTs) as StoredMessage[];
}

export function upsertGroup(db: Database.Database, id: string, name: string): void {
  const stmt = db.prepare(`
    INSERT INTO groups (id, name, last_message_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      last_message_at = excluded.last_message_at
  `);
  stmt.run(id, name, Date.now());
}

export function getGroups(db: Database.Database): Array<{ id: string; name: string; last_message_at: number | null }> {
  return db.prepare('SELECT id, name, last_message_at FROM groups').all() as Array<{
    id: string;
    name: string;
    last_message_at: number | null;
  }>;
}

export function getMessageCount(db: Database.Database, groupId: string): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM messages WHERE group_id = ?').get(groupId) as { count: number };
  return row.count;
}

export function getMessageCountsByGroup(db: Database.Database): Map<string, number> {
  const rows = db.prepare(
    'SELECT group_id, COUNT(*) as count FROM messages GROUP BY group_id'
  ).all() as Array<{ group_id: string; count: number }>;

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.group_id, row.count);
  }
  return map;
}

export function getTotalMessageCount(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
  return row.count;
}

export function getParticipantCount(db: Database.Database, groupId: string, since: number, until: number): number {
  const row = db.prepare(
    'SELECT COUNT(DISTINCT sender_id) as count FROM messages WHERE group_id = ? AND timestamp >= ? AND timestamp <= ?'
  ).get(groupId, since, until) as { count: number };
  return row.count;
}

export interface TopParticipant {
  name: string;
  count: number;
}

export function getTopParticipants(
  db: Database.Database,
  groupId: string,
  since: number,
  until: number,
  limit: number = 5
): TopParticipant[] {
  const stmt = db.prepare(`
    SELECT COALESCE(sender_name, sender_id) as name, COUNT(*) as count
    FROM messages
    WHERE group_id = ? AND timestamp >= ? AND timestamp <= ?
    GROUP BY sender_id
    ORDER BY count DESC
    LIMIT ?
  `);
  return stmt.all(groupId, since, until, limit) as TopParticipant[];
}
