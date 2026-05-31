import express, { Express, Request, Response } from 'express';
import Database from 'better-sqlite3';
import { AppConfig } from '../config/loader.js';
import { WhatsAppClient } from '../whatsapp/client.js';
import {
  getMessages,
  getGroups,
  getMessageCountsByGroup,
  getTotalMessageCount,
  getParticipantCount,
  getTopParticipants,
} from '../db/queries.js';
import { buildSummaryInput } from '../summary/aggregator.js';
import { requestLogger, errorHandler } from './middleware.js';
import { logger } from '../utils/logger.js';

const startTime = Date.now();

export function createApp(
  config: AppConfig,
  db: Database.Database,
  whatsapp: WhatsAppClient
): Express {
  const app = express();
  app.use(express.json());
  app.use(requestLogger);

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    const uptimeMs = Date.now() - startTime;
    const hours = Math.floor(uptimeMs / 3600000);
    const minutes = Math.floor((uptimeMs % 3600000) / 60000);

    const groups = getGroups(db);
    const totalMessages = getTotalMessageCount(db);

    res.json({
      status: 'connected',
      uptime: `${hours}h ${minutes}m`,
      groups: groups.length,
      totalMessages,
    });
  });

  // List all discovered groups
  app.get('/api/groups', (_req: Request, res: Response) => {
    const discoveredGroups = getGroups(db);
    const enabledIds = new Set(config.groups.filter((g) => g.enabled).map((g) => g.id));
    const countsByGroup = getMessageCountsByGroup(db);

    const result = discoveredGroups.map((g) => ({
      id: g.id,
      name: g.name,
      messageCount: countsByGroup.get(g.id) || 0,
      enabled: enabledIds.has(g.id),
    }));

    res.json(result);
  });

  // Fetch messages for a group
  app.get('/api/messages', (req: Request, res: Response) => {
    const groupId = req.query.groupId as string;
    const since = req.query.since as string;
    const until = req.query.until as string | undefined;

    if (!groupId || !since) {
      res.status(400).json({ error: 'groupId and since are required query params' });
      return;
    }

    const sinceTs = new Date(since).getTime();
    const untilTs = until ? new Date(until).getTime() : Date.now();

    if (isNaN(sinceTs)) {
      res.status(400).json({ error: 'Invalid since timestamp' });
      return;
    }

    const messages = getMessages(db, groupId, sinceTs, untilTs);
    const participants = getParticipantCount(db, groupId, sinceTs, untilTs);

    res.json({
      groupId,
      messageCount: messages.length,
      participants,
      messages: messages.map((m) => ({
        id: m.id,
        sender: m.sender_id,
        senderName: m.sender_name,
        timestamp: new Date(m.timestamp).toISOString(),
        text: m.text,
      })),
    });
  });

  // Primary endpoint for n8n — returns LLM-ready prompts for all enabled groups
  app.get('/api/summary-input', (req: Request, res: Response) => {
    const since = req.query.since as string | undefined;
    const until = req.query.until as string | undefined;

    const result = buildSummaryInput(db, config, since, until);
    res.json(result);
  });

  // Send a message to a WhatsApp group
  app.post('/api/send', async (req: Request, res: Response) => {
    const { groupId, message } = req.body;

    if (!groupId || !message) {
      res.status(400).json({ error: 'groupId and message are required' });
      return;
    }

    try {
      await whatsapp.sendMessage(groupId, message);
      logger.info(`Message sent to group ${groupId}`);
      res.json({ success: true, groupId });
    } catch (err) {
      logger.error('Failed to send message', err);
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  app.use(errorHandler);

  return app;
}
