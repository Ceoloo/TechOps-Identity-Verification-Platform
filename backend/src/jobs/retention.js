'use strict';

/**
 * Retention automation job (Phase 8).
 *
 * Intended to run on a schedule (cron/systemd timer/k8s CronJob), e.g. daily:
 *   node src/jobs/retention.js            # enforce retention
 *   node src/jobs/retention.js --dry-run  # report what would be affected
 *
 * Exits non-zero on failure so a scheduler can alert.
 */

const { runRetention } = require('../services/retentionService');
const { DbOtpStore } = require('../providers/otpStore');
const { close } = require('../db');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const results = await runRetention({ dryRun });

  // Housekeeping: purge expired email OTP challenges (independent of policy).
  if (!dryRun) {
    const purged = await DbOtpStore.deleteExpired();
    if (purged > 0) console.log(`[retention] purged ${purged} expired email OTP challenge(s).`);
  }

  let total = 0;
  for (const r of results) {
    if (r.skipped) {
      console.log(`[retention] SKIP ${r.data_type} (${r.reason}) business=${r.business_id}`);
      continue;
    }
    total += r.affected;
    console.log(
      `[retention] ${dryRun ? '(dry-run) ' : ''}${r.action} ${r.data_type}: ` +
        `${r.affected} affected (>${r.retention_days}d, cutoff ${r.cutoff}) business=${r.business_id}`
    );
  }
  console.log(`[retention] done — ${total} record(s) ${dryRun ? 'would be' : ''} affected across ${results.length} policy(ies).`);
}

if (require.main === module) {
  main()
    .then(() => close())
    .catch(async (err) => {
      console.error(`[retention] error: ${err.message}`);
      await close();
      process.exitCode = 1;
    });
}

module.exports = { main };
