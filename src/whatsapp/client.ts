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

// Mutable holder so reconnects update the socket used by sendMessage
const clientState: { socket: WASocket | null } = { socket: null };

export async function createWhatsAppClient(
  config: AppConfig,
  db: Database.Database
): Promise<WhatsAppClient> {
  const sessionPath = path.resolve(config.whatsapp.sessionDataPath);
  fs.mkdirSync(sessionPath, { recursive: true });

  // Clear stale device-list and app-state-sync cache to avoid persistent sync errors
  const staleFiles = fs.readdirSync(sessionPath).filter(
    (f) => f.startsWith('device-list-') || f.startsWith('app-state-sync-version-')
  );
  if (staleFiles.length > 0) {
    for (const file of staleFiles) {
      fs.unlinkSync(path.join(sessionPath, file));
    }
    logger.info(`Cleared ${staleFiles.length} stale session cache files`);
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const socket = makeWASocket({
    auth: state,
  });

  clientState.socket = socket;

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
    handleIncomingMessage(db, config, m, socket);
  });

  const DISCLAIMER = '\n\n_AI generated content may be inaccurate. Make sure to verify all information._';

  const sendMessage = async (groupId: string, text: string) => {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (!clientState.socket) {
        throw new Error('WhatsApp socket is not connected');
      }
      try {
        return await clientState.socket.sendMessage(groupId, { text: text + DISCLAIMER });
      } catch (err) {
        if (attempt < maxRetries) {
          const delay = attempt * 2000;
          logger.warn(`sendMessage attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
        } else {
          throw err;
        }
      }
    }
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

    // Fix any existing groups that have JID as name (from earlier bug)
    const existingGroups = db.prepare('SELECT id, name FROM groups').all() as Array<{ id: string; name: string }>;
    for (const g of existingGroups) {
      if (g.name === g.id && !(g.id in groups)) {
        try {
          const meta = await socket.groupMetadata(g.id);
          upsertGroup(db, g.id, meta.subject);
          logger.info(`Fixed group name for ${g.id}: ${meta.subject}`);
        } catch {
          logger.warn(`Could not fetch metadata for group ${g.id}`);
        }
      }
    }
  } catch (err) {
    logger.error('Failed to fetch groups from WhatsApp', err);
  }
}
