'use strict';

/**
 * Express application wiring. Exported separately from the server bootstrap so
 * tests can mount the app on an ephemeral port.
 */

const express = require('express');
const config = require('./config');
const publicIntakeRoutes = require('./routes/publicIntake');
const { errorHandler, notFound } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  // Correct client IP behind a proxy/load balancer (used for rate limiting and
  // consent record ip_address).
  app.set('trust proxy', config.trustProxy);

  app.use(express.json({ limit: '256kb' }));

  // Liveness/readiness.
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Public intake (Phase 4). Admin/reviewer routes are mounted in later phases.
  app.use('/api/public', publicIntakeRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
