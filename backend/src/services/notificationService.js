'use strict';

/**
 * Notification dispatch (Phase 5/6).
 *
 * Looks up the business's notification_settings for an event and records intent
 * to notify. Actual email transport is pluggable; when none is configured we
 * still write an audit entry so the dispatch is traceable. Recipient addresses
 * are internal staff — not subject PII — but we log only a count.
 */

const db = require('../db');
const { writeAudit } = require('../audit/log');

let transport = null; // optional: async (to, subject, body) => void

function setTransport(fn) {
  transport = fn;
}

async function getRecipients(businessId, eventType, runner = db) {
  const { rows } = await runner.query(
    `SELECT emails FROM notification_settings
      WHERE business_id=$1 AND event_type=$2 AND is_active=TRUE`,
    [businessId, eventType]
  );
  if (rows.length === 0) return [];
  const emails = rows[0].emails;
  return Array.isArray(emails) ? emails : [];
}

/**
 * Notify configured recipients that a verification needs manual review.
 * Best-effort: never throws into the caller's critical path.
 */
async function notifyManualReview({ businessId, verificationId }) {
  try {
    const recipients = await getRecipients(businessId, 'manual_review');
    if (recipients.length && transport) {
      const subject = 'Verification pending manual review';
      const body = `Verification ${verificationId} requires manual review.`;
      await Promise.all(recipients.map((to) => transport(to, subject, body)));
    }
    await writeAudit({
      businessId,
      actor: 'system',
      action: 'notification.manual_review',
      targetType: 'verification',
      targetId: verificationId,
      metadata: { recipient_count: recipients.length, dispatched: Boolean(transport && recipients.length) },
    });
  } catch (_err) {
    // Notification failures must not break verification processing.
  }
}

module.exports = { notifyManualReview, setTransport, getRecipients };
