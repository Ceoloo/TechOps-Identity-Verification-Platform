'use strict';

/**
 * Centralised error handling that never leaks PII or internals to clients.
 *
 * Known, safe errors (those with a `statusCode`, e.g. IntakeError) return their
 * message. Everything else returns a generic 500 with a correlation id; the
 * detail is logged server-side WITHOUT request bodies/params (which may hold
 * PII) — only the error class/message and correlation id.
 */

const crypto = require('crypto');

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;

  if (statusCode >= 400 && statusCode < 500) {
    return res.status(statusCode).json({ error: err.message || 'Bad request' });
  }

  const correlationId = crypto.randomBytes(8).toString('hex');
  // Log without any request payload; PII must never reach logs.
  // eslint-disable-next-line no-console
  console.error(`[error] ${correlationId} ${err.name}: ${err.message}`);
  return res
    .status(500)
    .json({ error: 'Internal server error', correlation_id: correlationId });
}

module.exports = { errorHandler, notFound };
