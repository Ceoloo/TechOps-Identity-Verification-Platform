'use strict';

/**
 * Server bootstrap. Verifies critical config (encryption key) before listening.
 */

const { createApp } = require('./app');
const config = require('./config');
const enc = require('./crypto/encryption');

function start() {
  if (!enc.isConfigured()) {
    // eslint-disable-next-line no-console
    console.error(
      '[startup] PII_ENCRYPTION_KEY is not set to a valid 32-byte base64 key. ' +
        'Refusing to start — PII cannot be encrypted.'
    );
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[startup] TechOps KYC API listening on :${config.port} ` +
        `(env=${config.env}, providerMode=${config.providerMode})`
    );
  });

  const shutdown = (signal) => {
    // eslint-disable-next-line no-console
    console.log(`[shutdown] ${signal} received, closing server`);
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  start();
}

module.exports = { start };
