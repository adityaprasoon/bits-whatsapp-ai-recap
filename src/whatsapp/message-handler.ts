import Database from 'better-sqlite3';
import { proto } from 'baileys';
import { AppConfig } from '../config/loader.js';
import { insertMessage, upsertGroup } from '../db/queries.js';
import { logger } from '../utils/logger.js';

interface MessageUpsert {
  messages: proto.IWebMessageInfo[];
  type: 'append' | 'notify';
}

export function handleIncomingMessage(
  db: Database.Database,
  config: AppConfig,
  upsert: MessageUpsert
): void {
  for (const msg of upsert.messages) {
    const key = msg.key;
    if (!key) continue;

    const remoteJid = key.remoteJid;
    if (!remoteJid || !remoteJid.endsWith('@g.us')) {
      continue; // Only process group messages
    }

    const text = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || null;

    if (!text) {
      continue; // Skip non-text messages for v1
    }

    const messageId = key.id;
    if (!messageId) continue;

    const senderId = key.participant;
    if (!senderId) continue; // Can't identify sender — skip
    
    const senderName = msg.pushName || null;
    const timestamp = typeof msg.messageTimestamp === 'number'
      ? msg.messageTimestamp * 1000
      : Number(msg.messageTimestamp) * 1000;

    insertMessage(db, {
      id: messageId,
      group_id: remoteJid,
      sender_id: senderId,
      sender_name: senderName,
      timestamp,
      text,
    });

    // Update group record
    upsertGroup(db, remoteJid, remoteJid); // name will be updated when group metadata is fetched

    logger.debug(`Stored message ${messageId} from ${senderName || senderId} in ${remoteJid}`);
  }
}
