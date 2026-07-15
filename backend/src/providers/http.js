'use strict';

/**
 * Minimal HTTP helper for live-mode provider calls.
 *
 * Uses the global `fetch` (Node >= 18). Adds a timeout and returns parsed JSON.
 * Errors are thrown with a provider/status context but WITHOUT request bodies,
 * so subject PII never ends up in an error message or log.
 */

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * @param {string} url
 * @param {Object} [opts]
 * @param {string} [opts.method='GET']
 * @param {Object} [opts.headers]
 * @param {Object|string} [opts.body] object is JSON-encoded
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.providerKey] for error context only
 * @returns {Promise<{ status: number, json: any }>}
 */
async function httpRequest(url, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    providerKey = 'provider',
  } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init = { method, headers: { ...headers }, signal: controller.signal };
    if (body !== undefined) {
      if (typeof body === 'string') {
        init.body = body;
      } else {
        init.body = JSON.stringify(body);
        init.headers['content-type'] =
          init.headers['content-type'] || 'application/json';
      }
    }
    const res = await fetch(url, init);
    let json = null;
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (_err) {
        json = { _raw: text.slice(0, 2000) };
      }
    }
    return { status: res.status, json };
  } catch (err) {
    // Do not attach the request body. Only the failure class + provider.
    const reason = err.name === 'AbortError' ? 'timeout' : err.message;
    const wrapped = new Error(`[${providerKey}] request failed: ${reason}`);
    wrapped.cause = err;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { httpRequest, DEFAULT_TIMEOUT_MS };
