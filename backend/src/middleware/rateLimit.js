'use strict';

/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * Protects the public intake endpoint from abuse without adding a dependency.
 * Keyed by client IP + an optional route scope (e.g. businessId). For a
 * multi-instance deployment, replace the in-memory Map with a shared store
 * (Redis) so limits are enforced across nodes — the interface stays the same.
 */

function rateLimit(options = {}) {
  const windowMs = options.windowMs || 60 * 1000;
  const max = options.max || 20;
  const keyGenerator =
    options.keyGenerator ||
    ((req) => `${req.ip}:${req.params.businessId || ''}`);

  const hits = new Map(); // key -> { count, resetAt }

  // Opportunistic cleanup so the Map doesn't grow unbounded.
  function sweep(now) {
    if (hits.size < 5000) return;
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    sweep(now);
    const key = keyGenerator(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests, please try again later.' });
    }
    return next();
  };
}

module.exports = { rateLimit };
