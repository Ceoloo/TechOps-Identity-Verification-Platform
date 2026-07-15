'use strict';

/**
 * PostgreSQL connection pool + thin query helpers.
 *
 * Everything that touches the database goes through here so we have a single
 * place to add tenant guards, statement timeouts, and query logging (which must
 * never log PII — see docs/README.md security notes).
 */

const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  // Fail fast rather than hanging a request if the DB is unreachable.
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10,
});

pool.on('error', (err) => {
  // Connection-level errors on idle clients. Do not include query text/params
  // (may contain PII). Log only the error class + message.
  // eslint-disable-next-line no-console
  console.error(`[db] idle client error: ${err.name}: ${err.message}`);
});

/**
 * Run a parameterised query.
 * @param {string} text SQL with $1..$n placeholders
 * @param {Array} [params]
 */
async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run `fn` inside a transaction, committing on success and rolling back on
 * any thrown error. `fn` receives a dedicated client.
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackErr) {
      // ignore rollback failure; original error is more useful
    }
    throw err;
  } finally {
    client.release();
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, withTransaction, close };
