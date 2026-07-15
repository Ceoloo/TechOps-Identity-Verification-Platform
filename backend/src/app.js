'use strict';

/**
 * Express application wiring. Exported separately from the server bootstrap so
 * tests can mount the app on an ephemeral port.
 */

const express = require('express');
const config = require('./config');
const publicIntakeRoutes = require('./routes/publicIntake');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const reviewRoutes = require('./routes/review');
const auditRoutes = require('./routes/audit');
const { errorHandler, notFound } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  // Correct client IP behind a proxy/load balancer (used for rate limiting and
  // consent record ip_address).
  app.set('trust proxy', config.trustProxy);

  app.use(express.json({ limit: '256kb' }));

  // Liveness/readiness.
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Public intake (Phase 4).
  app.use('/api/public', publicIntakeRoutes);
  // Internal: auth (Phase 5), admin config (5), review queue (6), audit + DSR (7).
  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/review', reviewRoutes);
  app.use('/api/audit', auditRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
