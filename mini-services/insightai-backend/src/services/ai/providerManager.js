'use strict';

/**
 * Provider-independent AI gateway.
 * - Gemini (6 server-side key slots: GEMINI_API_KEY_1..6) + Groq (3 slots: GROQ_API_KEY_1..3)
 * - Capability-based routing (text / json / vision) per task type
 * - Per-key request accounting, validity tracking, cooldown on 429 (honours retry-after),
 *   exponential backoff with jitter
 * - Round-robin rotation between keys of the same provider, then fallback to the other provider
 * - Geo-block awareness: "User location is not supported" (FAILED_PRECONDITION) means the KEY is
 *   valid but this server's egress region is blocked by Google — keys are kept valid and retried
 *   after a cooldown, and the platform fallback serves AI meanwhile.
 * - Never logs or exposes raw keys (masked form only); Gemini auth uses the x-goog-api-key header
 *   (keys never appear in URLs).
 */

const crypto = require('crypto');
const config = require('../../config');
const logger = require('../../utils/logger');

class ProviderError extends Error {
  constructor(message, { status = 503, code = 'PROVIDERS_UNAVAILABLE', statuses = [] } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.providerStatuses = statuses;
  }
}

// ─── Key state ─────────────────────────────────────────────────────────
function maskKey(key) {
  if (!key) return null;
  const head = key.slice(0, 4);
  const tail = key.slice(-4);
  return `${head}••••${tail}`;
}

function buildKeyStates() {
  const states = [];
  for (const provider of ['gemini', 'groq']) {
    config.providers[provider].keys.forEach((key, idx) => {
      states.push({
        id: `${provider}-${idx + 1}`,
        provider,
        keyIndex: idx,
        key,
        masked: maskKey(key),
        requests: 0,
        tokensIn: 0,
        tokensOut: 0,
        errors429: 0,
        validity: 'unknown', // 'unknown' | 'valid' | 'invalid' — auth-probed, never exposed raw
        cooldownUntil: 0,
        lastError: null,
        lastUsedAt: null,
      });
    });
  }
  return states;
}

const keyStates = buildKeyStates();
let roundRobin = 0;
const dayKey = () => new Date().toISOString().slice(0, 10);
let budgetCounters = { day: dayKey(), used: 0 };

function budgetCheck() {
  if (budgetCounters.day !== dayKey()) budgetCounters = { day: dayKey(), used: 0 };
  return budgetCounters.used;
}

// ─── Task routing table ────────────────────────────────────────────────
// Ordered candidates per task type. Vision tasks skip text-only models.
// The managed platform provider (no user keys, server-side) is appended LAST
// to every route: it only engages when all Gemini/Groq keys are unavailable.
const PLATFORM_TEXT = { provider: 'platform', model: 'glm-managed', caps: ['text', 'json'] };
const PLATFORM_VISION = { provider: 'platform', model: 'glm-managed-vision', caps: ['vision', 'json'] };

const TASK_ROUTES = {
  planner: [
    { provider: 'gemini', model: 'gemini-3.8-flash', caps: ['json'] },
    { provider: 'groq', model: 'llama-3.3-70b-versatile', caps: ['json'] },
    { provider: 'gemini', model: 'gemini-3.5-flash-lite', caps: ['json'] },
    { provider: 'groq', model: 'llama-3.1-8b-instant', caps: ['json'] },
    { provider: 'gemini', model: 'gemini-flash-latest', caps: ['json'] },
    PLATFORM_TEXT,
  ],
  explainer: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', caps: ['json'] },
    { provider: 'gemini', model: 'gemini-3.8-flash', caps: ['json'] },
    { provider: 'groq', model: 'llama-3.1-8b-instant', caps: ['json'] },
    { provider: 'gemini', model: 'gemini-3.5-flash-lite', caps: ['json'] },
    PLATFORM_TEXT,
  ],
  critic: [
    { provider: 'gemini', model: 'gemini-3.8-flash', caps: ['json'] },
    { provider: 'groq', model: 'llama-3.3-70b-versatile', caps: ['json'] },
    { provider: 'gemini', model: 'gemini-flash-latest', caps: ['json'] },
    PLATFORM_TEXT,
  ],
  chat: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', caps: ['text'] },
    { provider: 'gemini', model: 'gemini-3.8-flash', caps: ['text'] },
    { provider: 'groq', model: 'llama-3.1-8b-instant', caps: ['text'] },
    { provider: 'gemini', model: 'gemini-3.5-flash-lite', caps: ['text'] },
    PLATFORM_TEXT,
  ],
  vision: [
    { provider: 'gemini', model: 'gemini-3.8-flash', caps: ['vision', 'json'] },
    { provider: 'gemini', model: 'gemini-3.5-flash-lite', caps: ['vision', 'json'] },
    { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct', caps: ['vision'] },
    { provider: 'gemini', model: 'gemini-flash-latest', caps: ['vision', 'json'] },
    PLATFORM_VISION,
  ],
  summary: [
    { provider: 'groq', model: 'llama-3.1-8b-instant', caps: ['text'] },
    { provider: 'gemini', model: 'gemini-3.5-flash-lite', caps: ['text'] },
    { provider: 'gemini', model: 'gemini-flash-latest', caps: ['text'] },
    PLATFORM_TEXT,
  ],
};

function keysForProvider(provider) {
  const keys = keyStates.filter((k) => k.provider === provider);
  // start from rotating offset so load spreads across keys
  const offset = roundRobin % Math.max(1, keys.length);
  return [...keys.slice(offset), ...keys.slice(0, offset)];
}

function candidateOrder(taskType, { preferProvider } = {}) {
  let routes = TASK_ROUTES[taskType] || TASK_ROUTES.chat;
  if (preferProvider) {
    routes = [...routes.filter((r) => r.provider === preferProvider), ...routes.filter((r) => r.provider !== preferProvider)];
  }
  const expanded = [];
  for (const route of routes) {
    if (route.provider === 'platform') {
      // managed provider — no user keys involved
      if (config.ai.platformEnabled) expanded.push({ ...route, keyState: null, modelDef: { id: route.model, capabilities: route.caps } });
      continue;
    }
    const modelDef = config.providers[route.provider].models.find((m) => m.id === route.model);
    if (!modelDef) continue;
    for (const keyState of keysForProvider(route.provider)) {
      expanded.push({ ...route, keyState, modelDef });
    }
  }
  return expanded;
}

// ─── Low-level provider calls ──────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callGemini({ key, model, system, user, images, jsonMode, temperature = 0.3, maxTokens = 4096, timeoutMs }) {
  const parts = [];
  if (user) parts.push({ text: user });
  for (const img of images || []) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
  }
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (jsonMode) body.generationConfig.responseMimeType = 'application/json';

  const url = `${config.providers.gemini.baseUrl}/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* leave null */ }

  if (!res.ok) {
    const reason = data?.error?.message || text.slice(0, 200);
    const err = new Error(`Gemini ${res.status}: ${reason}`);
    err.status = res.status;
    err.retryAfter = parseInt(res.headers.get('retry-after') || '0', 10) || null;
    err.detailCode = data?.error?.status;
    throw err;
  }

  const blocked = data?.promptFeedback?.blockReason;
  if (blocked) {
    const err = new Error(`Gemini blocked the request (${blocked})`);
    err.status = 400;
    err.blocked = true;
    throw err;
  }

  const outText = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();
  if (!outText) {
    const err = new Error('Gemini returned empty candidate');
    err.status = 502;
    throw err;
  }
  return {
    text: outText,
    tokensIn: data?.usageMetadata?.promptTokenCount || 0,
    tokensOut: data?.usageMetadata?.candidatesTokenCount || 0,
  };
}

async function callGroq({ key, model, system, user, images, jsonMode, temperature = 0.3, maxTokens = 4096, timeoutMs }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  if (images && images.length) {
    messages.push({
      role: 'user',
      content: [
        ...(user ? [{ type: 'text', text: user }] : []),
        ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } })),
      ],
    });
  } else if (user) {
    messages.push({ role: 'user', content: user });
  }

  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch(`${config.providers.groq.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* leave null */ }

  if (!res.ok) {
    const reason = data?.error?.message || text.slice(0, 200);
    const err = new Error(`Groq ${res.status}: ${reason}`);
    err.status = res.status;
    err.retryAfter = parseInt(res.headers.get('retry-after') || '0', 10) || null;
    throw err;
  }

  const outText = data?.choices?.[0]?.message?.content || '';
  if (!outText.trim()) {
    const err = new Error('Groq returned empty choice');
    err.status = 502;
    throw err;
  }
  return {
    text: outText,
    tokensIn: data?.usage?.prompt_tokens || 0,
    tokensOut: data?.usage?.completion_tokens || 0,
  };
}

// Managed platform provider — internal Next.js proxy (server-side SDK).
async function callPlatform({ system, user, images, jsonMode, maxTokens, timeoutMs }) {
  const endpoint = images && images.length ? '/api/ai/vision' : '/api/ai/llm';
  const res = await fetch(`${config.ai.nextHost}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-token': process.env.INTERNAL_AI_PROXY_TOKEN || '',
    },
    body: JSON.stringify({ system, user, jsonMode, maxTokens, images }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* leave null */ }
  if (!res.ok || !data?.success) {
    const err = new Error(`Platform ${res.status}: ${data?.error?.message || text.slice(0, 160)}`);
    err.status = res.status >= 500 ? 503 : res.status;
    throw err;
  }
  return { text: String(data.text || ''), tokensIn: 0, tokensOut: 0 };
}

// ─── Extract JSON defensively ──────────────────────────────────────────
function balancedJsonSlice(text) {
  // Walk the text and return the first complete, balanced {...} or [...] block
  // (string- and escape-aware). Handles prose-wrapped JSON reliably.
  const openCh = text.search(/[[{]/);
  if (openCh < 0) return null;
  const pairs = { '{': '}', '[': ']' };
  const stack = [];
  let inStr = false;
  let esc = false;
  for (let i = openCh; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if (!open || pairs[open] !== ch) return null;
      if (stack.length === 0) return text.slice(openCh, i + 1);
    }
  }
  return null;
}

function extractJson(text) {
  const cleaned = String(text || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // 1) direct parse
  try { return JSON.parse(cleaned); } catch { /* continue */ }

  // 2) balanced-brace extraction (prose-wrapped JSON)
  const sliced = balancedJsonSlice(cleaned);
  if (sliced) {
    try { return JSON.parse(sliced); } catch { /* continue */ }
  }

  // 3) common near-JSON repairs: smart quotes, trailing commas, NaN/Infinity
  const base = sliced || cleaned;
  const repaired = base
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\b(NaN|Infinity|-Infinity)\b/g, 'null');
  try { return JSON.parse(repaired); } catch { /* fallthrough */ }

  // 4) repaired + balanced re-extraction
  const resliced = balancedJsonSlice(repaired);
  if (resliced) {
    try { return JSON.parse(resliced); } catch { /* fallthrough */ }
  }

  throw new Error('Model response was not valid JSON');
}

// ─── Public API ────────────────────────────────────────────────────────
/**
 * Execute a task against the best available provider/model.
 * Tries each (provider, model, key) candidate; applies backoff+jitter on
 * transient failures; marks keys cooling down on 429; never retries a
 * hard-failed request body.
 */
async function runTask(taskType, { system, user, images = [], jsonMode = false, temperature, maxTokens, timeoutMs, preferProvider, label = taskType }) {
  if (keyStates.length === 0 && !config.ai.platformEnabled) {
    throw new ProviderError('No AI provider keys are configured and the platform fallback is disabled. AI features are off; deterministic results are still available.', { code: 'AI_NOT_CONFIGURED', status: 503 });
  }
  const used = budgetCheck();
  if (used >= config.ai.dailyRequestBudget) {
    throw new ProviderError('AI request budget for today has been reached. Deterministic results remain available.', { code: 'AI_BUDGET_REACHED', status: 429 });
  }

  const candidates = candidateOrder(taskType, { preferProvider });
  if (candidates.length === 0) {
    throw new ProviderError(`No provider/model configured for task "${taskType}"`, { code: 'AI_NOT_CONFIGURED' });
  }

  const attempts = [];
  const now = Date.now();
  const perAttemptTimeout = timeoutMs || config.ai.timeoutMs;

  for (const cand of candidates) {
    const ks = cand.keyState;
    if (ks) {
      if (ks.cooldownUntil > now) {
        attempts.push({ candidate: `${cand.provider}/${cand.model}#${ks.id}`, skipped: 'cooldown' });
        continue;
      }
      if (ks.lastError && ks.lastError.hardInvalid) continue;
    }

    const maxAttempts = config.ai.maxRetries + 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        budgetCounters.used += 1;
        if (ks) {
          ks.requests += 1;
          ks.lastUsedAt = new Date().toISOString();
        }
        roundRobin += 1;

        const fn = cand.provider === 'gemini' ? callGemini : cand.provider === 'groq' ? callGroq : callPlatform;
        const result = await fn({
          key: ks ? ks.key : undefined,
          model: cand.model,
          system,
          user,
          images,
          jsonMode,
          temperature: temperature ?? 0.3,
          maxTokens: maxTokens || 4096,
          timeoutMs: perAttemptTimeout,
        });
        if (ks) {
          ks.tokensIn += result.tokensIn;
          ks.tokensOut += result.tokensOut;
          ks.lastError = null;
          ks.validity = 'valid';
          ks.consecutiveFailures = 0;
        }
        logger.info({ task: label, provider: cand.provider, model: cand.model, key: ks ? ks.id : 'managed', tokensIn: result.tokensIn, tokensOut: result.tokensOut }, 'AI call ok');
        return { text: result.text, provider: cand.provider, model: cand.model, keyId: ks ? ks.id : 'managed' };
      } catch (err) {
        const status = err.status || 0;
        const msg = String(err.message || '');
        const geoBlocked = err.detailCode === 'FAILED_PRECONDITION' || /location is not supported/i.test(msg);
        attempts.push({ candidate: `${cand.provider}/${cand.model}#${ks ? ks.id : 'managed'}`, attempt, error: msg.slice(0, 160), status });
        logger.warn({ task: label, provider: cand.provider, model: cand.model, key: ks ? ks.id : 'managed', status, attempt, geoBlocked, error: msg.slice(0, 200) }, 'AI call failed');

        if (ks && geoBlocked) {
          // Auth already passed (Google validates the key before the geo check) —
          // the KEY is valid; only this server's egress region is blocked.
          ks.validity = 'valid';
          ks.lastError = { message: 'region-blocked (key valid)', at: new Date().toISOString(), hardInvalid: false, geoBlocked: true };
          ks.cooldownUntil = Date.now() + 15 * 60 * 1000; // re-check in 15 min — do not hammer a doomed route
          break; // move to next key/model
        }
        if (ks && status === 429) {
          ks.errors429 += 1;
          const ra = err.retryAfter && err.retryAfter > 0 ? err.retryAfter * 1000 : Math.min(60000, 5000 * Math.pow(2, ks.errors429));
          ks.cooldownUntil = Date.now() + ra + Math.floor(Math.random() * 1000);
          ks.lastError = { message: 'rate limited', at: new Date().toISOString(), hardInvalid: false };
          break; // move to next key/model — do not hammer the same key
        }
        if (ks && (status === 401 || status === 403)) {
          ks.validity = 'invalid';
          ks.lastError = { message: 'key rejected', at: new Date().toISOString(), hardInvalid: true };
          break; // invalid key — stop using it
        }
        if (status === 404 && /no longer available/i.test(msg)) {
          // Retired model — a config concern, not a key concern; try the next model candidate.
          break;
        }
        if (status === 400 && err.blocked) {
          ks.lastError = { message: 'content blocked', at: new Date().toISOString(), hardInvalid: false };
          throw new ProviderError('The AI provider refused this content (safety block).', { code: 'AI_BLOCKED', status: 422, statuses: attempts });
        }
        if (status >= 500 || status === 0) {
          // transient — exponential backoff with jitter, then retry or move on
          if (attempt < maxAttempts - 1) {
            const backoff = 600 * Math.pow(2, attempt) + Math.floor(Math.random() * 400);
            await sleep(backoff);
            continue;
          }
          break;
        }
        // 4xx other (bad request etc.) — do not retry same body
        break;
      }
    }
  }

  const err = new ProviderError(
    'All configured AI providers are unavailable or rate-limited right now. Deterministic analysis is still available.',
    { code: 'PROVIDERS_UNAVAILABLE', statuses: attempts }
  );
  throw err;
}

async function runJSON(taskType, opts) {
  const res = await runTask(taskType, { ...opts, jsonMode: true });
  let parsed;
  try {
    parsed = extractJson(res.text);
  } catch (e) {
    // one bounded retry with a stricter instruction
    const retry = await runTask(taskType, {
      ...opts,
      jsonMode: true,
      user: `${opts.user}\n\nIMPORTANT: Respond with ONLY a valid JSON object. No prose, no markdown fences.`,
      label: `${opts.label || taskType}-json-retry`,
    });
    parsed = extractJson(retry.text);
    return { data: parsed, provider: retry.provider, model: retry.model, keyId: retry.keyId };
  }
  return { data: parsed, provider: res.provider, model: res.model, keyId: res.keyId };
}

/** Masked, credential-free status for the UI */
function getStatus() {
  if (budgetCounters.day !== dayKey()) budgetCounters = { day: dayKey(), used: 0 };
  const byProvider = {};
  for (const provider of ['gemini', 'groq']) {
    const cfgP = config.providers[provider];
    byProvider[provider] = {
      configured: cfgP.keys.length > 0,
      models: cfgP.models.map((m) => m.id),
      keys: keyStates
        .filter((k) => k.provider === provider)
        .map((k) => ({
          slot: k.keyIndex + 1,
          masked: k.masked,
          validity: k.validity,
          requests: k.requests,
          tokensIn: k.tokensIn,
          tokensOut: k.tokensOut,
          rateLimitHits: k.errors429,
          coolingDown: k.cooldownUntil > Date.now(),
          cooldownSecondsRemaining: k.cooldownUntil > Date.now() ? Math.ceil((k.cooldownUntil - Date.now()) / 1000) : 0,
          lastError: k.lastError ? k.lastError.message : null,
          lastUsedAt: k.lastUsedAt,
        })),
    };
  }
  byProvider.platform = {
    configured: config.ai.platformEnabled,
    mode: 'managed-fallback',
    models: ['glm-managed', 'glm-managed-vision'],
    keys: [],
    note: 'Server-managed fallback — no user keys. Engages automatically when every Gemini/Groq key is unavailable.',
  };
  return {
    providers: byProvider,
    budget: { day: budgetCounters.day, used: budgetCounters.used, limit: config.ai.dailyRequestBudget },
    note: 'Keys are masked; raw credentials are never returned by the API.',
  };
}

/** One tiny live ping per provider (used by the "Test providers" button) */
async function pingProviders() {
  const results = {};
  for (const provider of ['gemini', 'groq', 'platform']) {
    if (provider === 'platform') {
      if (!config.ai.platformEnabled) {
        results.platform = { ok: false, reason: 'Platform fallback disabled (PLATFORM_AI_DISABLED=true)' };
        continue;
      }
      try {
        const t0 = Date.now();
        await callPlatform({ system: null, user: 'Reply with the single word: OK', jsonMode: false, timeoutMs: 20000 });
        results.platform = { ok: true, model: 'glm-managed', latencyMs: Date.now() - t0 };
      } catch (err) {
        results.platform = { ok: false, reason: String(err.message).slice(0, 160) };
      }
      continue;
    }
    const model = (config.providers[provider].models[0] || {}).id;
    if (!model) {
      results[provider] = { ok: false, reason: 'No model configured' };
      continue;
    }
    const ks = keysForProvider(provider).find((k) => k.cooldownUntil <= Date.now() && !(k.lastError && k.lastError.hardInvalid));
    if (!ks) {
      results[provider] = { ok: false, reason: 'No available key (cooling down or rejected)' };
      continue;
    }
    try {
      const fn = provider === 'gemini' ? callGemini : callGroq;
      const t0 = Date.now();
      await fn({ key: ks.key, model, system: null, user: 'Reply with the single word: OK', jsonMode: false, temperature: 0, maxTokens: 8, timeoutMs: 15000 });
      results[provider] = { ok: true, model, latencyMs: Date.now() - t0, keySlot: ks.keyIndex + 1 };
      ks.requests += 1;
      ks.validity = 'valid';
    } catch (err) {
      const msg = String(err.message || '');
      const geoBlocked = err.detailCode === 'FAILED_PRECONDITION' || /location is not supported/i.test(msg);
      if (geoBlocked) {
        // Auth passed (Google validates the key before the geo check) — key is valid,
        // but this server's egress region is blocked by Google for AI generation.
        ks.validity = 'valid';
        ks.lastError = { message: 'region-blocked (key valid)', at: new Date().toISOString(), hardInvalid: false, geoBlocked: true };
        results[provider] = {
          ok: false,
          keyValid: true,
          regionBlocked: true,
          keySlot: ks.keyIndex + 1,
          reason: "Keys are valid — this server's egress region is blocked by Google ('User location is not supported'). Keys auto-engage from a supported region; platform fallback is serving AI meanwhile.",
        };
      } else {
        results[provider] = { ok: false, reason: msg.slice(0, 160), keySlot: ks.keyIndex + 1 };
        if (err.status === 429) {
          ks.cooldownUntil = Date.now() + ((err.retryAfter || 30) * 1000);
          ks.errors429 += 1;
        }
        if (err.status === 401 || err.status === 403) {
          ks.validity = 'invalid';
          ks.lastError = { message: 'key rejected', at: new Date().toISOString(), hardInvalid: true };
        }
      }
    }
  }
  return results;
}

module.exports = { runTask, runJSON, getStatus, pingProviders, ProviderError, extractJson };
