'use strict';

/**
 * Minimal, dependency-light SQL migration runner.
 *
 * - Migration files live in `/migrations` at the repo root, named
 *   `NNN_description.sql` (applied in ascending numeric order).
 * - Each file may contain an `-- @UP` section and an optional `-- @DOWN`
 *   section. If no markers are present the whole file is treated as UP.
 * - Applied migrations are tracked in `schema_migrations`.
 * - Each migration runs inside its own transaction.
 *
 * Usage:
 *   node src/db/migrate.js up        # apply all pending migrations
 *   node src/db/migrate.js down      # roll back the most recent migration
 *   node src/db/migrate.js status    # show applied vs pending
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('./index');

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../migrations');

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

function parseSections(sql) {
  const upMarker = /^--\s*@UP\s*$/im;
  const downMarker = /^--\s*@DOWN\s*$/im;
  if (!upMarker.test(sql)) {
    return { up: sql, down: null };
  }
  const downMatch = sql.match(downMarker);
  if (!downMatch) {
    return { up: sql.replace(upMarker, ''), down: null };
  }
  const downIndex = downMatch.index;
  const up = sql.slice(0, downIndex).replace(upMarker, '');
  const down = sql.slice(downIndex).replace(downMarker, '');
  return { up: up.trim(), down: down.trim() };
}

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getApplied(client) {
  const { rows } = await client.query(
    'SELECT filename, checksum FROM schema_migrations ORDER BY filename'
  );
  return rows;
}

async function up() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = new Map(
      (await getApplied(client)).map((r) => [r.filename, r.checksum])
    );
    const files = listMigrationFiles();
    let count = 0;

    for (const file of files) {
      const full = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(full, 'utf8');
      const sum = checksum(sql);

      if (applied.has(file)) {
        if (applied.get(file) !== sum) {
          throw new Error(
            `Migration ${file} was modified after being applied ` +
              '(checksum mismatch). Create a new migration instead.'
          );
        }
        continue;
      }

      const { up: upSql } = parseSections(sql);
      process.stdout.write(`[migrate] applying ${file} ... `);
      await client.query('BEGIN');
      try {
        await client.query(upSql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [file, sum]
        );
        await client.query('COMMIT');
        process.stdout.write('ok\n');
        count += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        process.stdout.write('FAILED\n');
        throw err;
      }
    }

    if (count === 0) {
      console.log('[migrate] no pending migrations.');
    } else {
      console.log(`[migrate] applied ${count} migration(s).`);
    }
  } finally {
    client.release();
  }
}

async function down() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);
    if (applied.length === 0) {
      console.log('[migrate] nothing to roll back.');
      return;
    }
    const last = applied[applied.length - 1].filename;
    const full = path.join(MIGRATIONS_DIR, last);
    const sql = fs.readFileSync(full, 'utf8');
    const { down: downSql } = parseSections(sql);
    if (!downSql) {
      throw new Error(
        `Migration ${last} has no -- @DOWN section; cannot roll back.`
      );
    }
    process.stdout.write(`[migrate] rolling back ${last} ... `);
    await client.query('BEGIN');
    try {
      await client.query(downSql);
      await client.query('DELETE FROM schema_migrations WHERE filename = $1', [
        last,
      ]);
      await client.query('COMMIT');
      process.stdout.write('ok\n');
    } catch (err) {
      await client.query('ROLLBACK');
      process.stdout.write('FAILED\n');
      throw err;
    }
  } finally {
    client.release();
  }
}

async function status() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = new Set((await getApplied(client)).map((r) => r.filename));
    const files = listMigrationFiles();
    console.log('Migration status:');
    for (const file of files) {
      console.log(`  [${applied.has(file) ? 'x' : ' '}] ${file}`);
    }
    const pending = files.filter((f) => !applied.has(f));
    console.log(
      `\n${applied.size} applied, ${pending.length} pending, ${files.length} total.`
    );
  } finally {
    client.release();
  }
}

async function main() {
  const cmd = process.argv[2] || 'up';
  try {
    if (cmd === 'up') await up();
    else if (cmd === 'down') await down();
    else if (cmd === 'status') await status();
    else {
      console.error(`Unknown command: ${cmd}. Use up | down | status.`);
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(`[migrate] error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { up, down, status, parseSections, listMigrationFiles };
