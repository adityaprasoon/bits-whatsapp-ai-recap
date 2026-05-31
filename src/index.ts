import { loadConfig } from './config/loader.js';
import { initDatabase } from './db/sqlite.js';
import { createWhatsAppClient } from './whatsapp/client.js';
import { createApp } from './api/routes.js';
import { logger } from './utils/logger.js';

async function main() {
  const config = loadConfig();

  logger.info('Starting WhatsApp Recap Service...');

  const db = initDatabase(config.server.dataDir);

  const whatsapp = await createWhatsAppClient(config, db);

  const app = createApp(config, db, whatsapp);
  const port = config.server.port;

  app.listen(port, () => {
    logger.info(`HTTP server listening on port ${port}`);
  });
}

main().catch((err) => {
  logger.error('Fatal error during startup', err);
  process.exit(1);
});
