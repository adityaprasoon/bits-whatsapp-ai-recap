import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  WAMessage,
} from 'baileys';
import { Boom } from '@hapi/boom';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { AppConfig } from '../config/loader.js';
import { handleIncomingMessage } from './message-handler.js';
import { upsertGroup } from '../db/queries.js';
import { logger } from '../utils/logger.js';
import qrcode from 'qrcode-terminal';

export interface WhatsAppClient {
  socket: WASocket;
  sendMessage: (groupId: string, text: string) => Promise<WAMessage | undefined>;
}

export async function createWhatsAppClient(
  config: AppConfig,
  db: Database.Database
): Promise<WhatsAppClient> {
  const sessionPath = path.resolve(config.whatsapp.sessionDataPath);
  fs.mkdirSync(sessionPath, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const socket = makeWASocket({
    auth: state,
  });

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('QR code generated — scan with WhatsApp mobile app');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn(`Connection closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        createWhatsAppClient(config, db);
      } else {
        logger.error('Logged out. Delete session folder and restart to re-authenticate.');
      }
    }

    if (connection === 'open') {
      logger.info('WhatsApp connection established');
      fetchAndStoreGroups(socket, db);
    }
  });

  socket.ev.on('messages.upsert', (m) => {
    handleIncomingMessage(db, config, m);
  });

  const sendMessage = async (groupId: string, text: string) => {
    return socket.sendMessage(groupId, { text });
  };

  return { socket, sendMessage };
}

async function fetchAndStoreGroups(socket: WASocket, db: Database.Database): Promise<void> {
  try {
    const groups = await socket.groupFetchAllParticipating();
    let count = 0;
    for (const group of Object.values(groups)) {
      upsertGroup(db, group.id, group.subject);
      count++;
    }
    logger.info(`Fetched and stored ${count} groups from WhatsApp`);
  } catch (err) {
    logger.error('Failed to fetch groups from WhatsApp', err);
  }
}
