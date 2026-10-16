'use strict';

/**
 * Disk-backed cache for AI operations, keyed by operation + payload + model-agnostic
 * inputs. Prevents repeat AI spend when re-analyzing unchanged datasets.
 * Cache is invalidated implicitly because payloads embed the dataset version hash.
 */

const crypto = require('crypto');
const storage = require('../../storage/manager');
const logger = require('../../utils/logger');

function hashPayload(op, payload) {
  // Sorted-key JSON for deterministic hashing
  const sorted = JSON.stringify(sortDeep({ op, payload }));
  return crypto.createHash('sha256').update(sorted).digest('hex');
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortDeep(value[k]);
    return out;
  }
  return value;
}

/**
 * Run a JSON task with cache. `payload` must fully determine the response
 * (include dataset version hash where relevant).
 */
async function cachedRunJSON(op, taskType, payload, opts) {
  const hash = hashPayload(op, payload);
  const hit = storage.getCache(hash);
  if (hit && hit.data !== undefined) {
    logger.info({ op, hash: hash.slice(0, 12) }, 'AI cache hit');
    return { data: hit.data, provider: hit.provider, model: hit.model, cached: true, cacheHash: hash };
  }
  const res = await run(op, taskType, payload, opts, hash);
  return res;
}

async function run(op, taskType, payload, opts, hash) {
  // Lazy import to avoid circular dependency at module load
  const providerManager = require('./providerManager');
  const res = await providerManager.runJSON(taskType, opts);
  try {
    storage.setCache(hash, { op, data: res.data, provider: res.provider, model: res.model });
  } catch (e) {
    logger.warn({ op, err: String(e) }, 'Failed to persist AI cache entry');
  }
  return { data: res.data, provider: res.provider, model: res.model, cached: false, cacheHash: hash };
}

module.exports = { cachedRunJSON, hashPayload };
