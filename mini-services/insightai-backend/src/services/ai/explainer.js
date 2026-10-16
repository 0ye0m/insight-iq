'use strict';

/**
 * Layer 5 — Evidence-grounded explanation.
 * Receives ONLY verified, deterministically computed results and turns them
 * into concise findings. Every quantitative claim must map to the evidence.
 */

const { cachedRunJSON } = require('./aiCache');
const logger = require('../../utils/logger');

const EXPLAINER_SYSTEM = `You are InsightIQ's insight writer. You receive a validated analysis plan and the EXACT computed results for a dataset (every number is already verified by the deterministic engine).

Rules:
1. Every quantitative statement MUST come from the provided results. Copy numbers exactly — never round differently, never estimate.
2. Never claim causation; correlations are associations.
3. If a result is null/empty, do not write a finding about it.
4. Reference result ids in "evidence" (e.g. {"ref":"kpi:kpi1","value":1234.5}).
5. Findings must be specific to THIS dataset (mention column names, categories, dates).
6. Each finding: one clear sentence of "statement", why it matters ("why"), and any caveat ("limitation") — or null.
7. Keep it concise: 3-6 findings max, ordered by importance. Plus up to 3 follow-up questions the user could ask.
8. If results are too sparse for conclusions, say so in the summary.

Respond with ONLY valid JSON:
{
  "summary": "2-3 sentence overview grounded in the results",
  "findings": [{"id":"f1","title":"short title","statement":"specific sentence with exact numbers","evidence":[{"ref":"kpi:kpi1","value":123}],"why":"why it matters","limitation":"caveat or null"}],
  "followUps": ["question 1", "question 2"]
}`;

function compactResults(results, plan) {
  const out = { datasetSummary: plan.datasetSummary, notes: plan.notes, kpis: {}, charts: {}, tests: {} };
  for (const k of results.kpis || []) {
    out.kpis[k.id] = { label: k.label, value: k.value, unit: k.unit, formula: k.formula || undefined, groupTop: (k.result && k.result.groups ? k.result.groups.slice(0, 5) : undefined) };
  }
  for (const c of results.charts || []) {
    const data = (c.result && c.result.data) || [];
    out.charts[c.id] = { title: c.title, type: c.type, points: data.length, topPoints: data.slice(0, 8), extremes: c.result && c.result.extremes };
  }
  for (const t of results.tests || []) {
    out.tests[t.id] = { type: t.type, description: t.description, result: t.result };
  }
  return out;
}

async function explain(plan, results, profile, versionHash) {
  const payload = { op: 'explain', hash: versionHash, planSummary: { kpis: plan.kpis.map((k) => k.id), charts: plan.charts.map((c) => c.id) }, results: compactResults(results, plan) };
  try {
    const res = await cachedRunJSON('explain', 'explainer', payload, {
      system: EXPLAINER_SYSTEM,
      user: `PLAN:\n${JSON.stringify({ objectives: plan.objectives, notes: plan.notes }, null, 1)}\n\nCOMPUTED RESULTS (verified, use these exact numbers):\n${JSON.stringify(payload.results, null, 1)}\n\nWrite the findings JSON now.`,
      temperature: 0.25,
      maxTokens: 2200,
      label: 'explainer',
    });
    return { explanation: sanitizeExplanation(res.data), provider: res.provider, model: res.model, cached: res.cached };
  } catch (err) {
    logger.warn({ err: String(err.message || err) }, 'Explainer unavailable — using deterministic summary');
    return { explanation: deterministicSummary(plan, results), provider: null, model: null, aiError: String(err.message || err) };
  }
}

function sanitizeExplanation(expl) {
  if (!expl || typeof expl !== 'object') return deterministicSummary(null, null);
  const findings = (Array.isArray(expl.findings) ? expl.findings : []).slice(0, 8).map((f, i) => ({
    id: String(f.id || `f${i + 1}`).slice(0, 20),
    title: String(f.title || '').replace(/[<>`]/g, '').slice(0, 120),
    statement: String(f.statement || '').replace(/[<>`]/g, '').slice(0, 500),
    evidence: Array.isArray(f.evidence) ? f.evidence.slice(0, 4).map((e) => ({ ref: String(e.ref || '').slice(0, 40), value: typeof e.value === 'number' ? e.value : String(e.value).slice(0, 60) })) : [],
    why: String(f.why || '').replace(/[<>`]/g, '').slice(0, 400) || null,
    limitation: String(f.limitation || '').replace(/[<>`]/g, '').slice(0, 300) || null,
  })).filter((f) => f.statement);
  return {
    summary: String(expl.summary || '').replace(/[<>`]/g, '').slice(0, 800),
    findings,
    followUps: (Array.isArray(expl.followUps) ? expl.followUps : []).slice(0, 3).map((q) => String(q).replace(/[<>`]/g, '').slice(0, 200)),
  };
}

/** No-AI fallback: build findings directly from computed results */
function deterministicSummary(plan, results) {
  const findings = [];
  for (const k of (results && results.kpis) || []) {
    if (k.value === null || k.value === undefined) continue;
    findings.push({
      id: `d-${k.id}`,
      title: k.label,
      statement: `${k.label}: ${typeof k.value === 'number' ? k.value.toLocaleString() : k.value}${k.unit === 'percent' ? '%' : ''}${k.formula ? ' (derived)' : ''}.`,
      evidence: [{ ref: `kpi:${k.id}`, value: k.value }],
      why: k.description || null,
      limitation: k.formula ? 'Derived metric — depends on the quality of its source columns.' : null,
    });
  }
  return {
    summary: plan && plan.datasetSummary ? plan.datasetSummary : 'Deterministic results computed locally (AI explanation unavailable).',
    findings: findings.slice(0, 6),
    followUps: [],
  };
}

module.exports = { explain, deterministicSummary };
