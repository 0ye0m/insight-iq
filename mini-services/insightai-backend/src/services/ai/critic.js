'use strict';

/**
 * Layer 6 — Optional verification critic.
 * Invoked ONLY for high-risk findings (causal language, growth/rate claims,
 * strong correlations) — not for every statistic. Checks each flagged finding
 * against the verified evidence and removes/corrects unsupported claims.
 */

const { cachedRunJSON } = require('./aiCache');
const logger = require('../../utils/logger');

const CAUSAL_PATTERNS = /\b(caused by|causes|because of|due to|drives|driving|leads? to|results? in|impacts?|effect of|attributable)\b/i;
const GROWTH_PATTERNS = /\b(grew|growth|increased|decreased|declined|doubled|tripled|trend|over time|improved|dropped)\b/i;

const CRITIC_SYSTEM = `You are InsightIQ's verification critic. You receive findings and the exact verified evidence they cite.

For each finding, check:
1. Unsupported claims: numbers or relationships not present in the cited evidence.
2. Causal language where only correlation/comparison exists.
3. Wrong direction or misreading of a relationship.
4. Missing caveats for derived metrics or small samples.
5. Recommendations that contradict the evidence.

Respond with ONLY valid JSON:
{
  "verdicts": [{"id":"f1","verdict":"keep|fix|remove","correctedStatement":"required when verdict=fix","reason":"short reason"}],
  "overall": "one short sentence"
}
Be strict: when evidence does not support a numeric or causal claim, prefer "remove".`;

function shouldCriticize(explanation, results) {
  if (!explanation || !Array.isArray(explanation.findings)) return false;
  const risky = explanation.findings.some((f) => CAUSAL_PATTERNS.test(f.statement || '') || GROWTH_PATTERNS.test(f.statement || ''));
  const strongCorr = (results.tests || []).some((t) => t.type === 'correlation' && t.result && Math.abs(t.result.correlation) >= 0.5);
  return risky || strongCorr;
}

function buildEvidenceMap(results, profile) {
  const map = {};
  for (const k of results.kpis || []) map[`kpi:${k.id}`] = { label: k.label, value: k.value, groups: k.result && k.result.groups };
  for (const c of results.charts || []) map[`chart:${c.id}`] = { title: c.title, type: c.type, top: ((c.result && c.result.data) || []).slice(0, 6), extremes: c.result && c.result.extremes };
  for (const t of results.tests || []) map[`test:${t.id}`] = { type: t.type, result: t.result };
  return map;
}

async function critique(explanation, results, profile, versionHash) {
  if (!shouldCriticize(explanation, results)) {
    return { applied: false, reason: 'no high-risk findings', explanation };
  }
  const evidence = buildEvidenceMap(results, profile);
  const payload = { op: 'critique', hash: versionHash, findings: explanation.findings, evidence };
  try {
    const res = await cachedRunJSON('critique', 'critic', payload, {
      system: CRITIC_SYSTEM,
      user: `FINDINGS:\n${JSON.stringify(explanation.findings, null, 1)}\n\nVERIFIED EVIDENCE:\n${JSON.stringify(evidence, null, 1)}\n\nReturn the verdicts JSON now.`,
      temperature: 0.1,
      maxTokens: 1800,
      label: 'critic',
    });
    const verdicts = Array.isArray(res.data.verdicts) ? res.data.verdicts : [];
    const overall = typeof res.data.overall === 'string' ? res.data.overall.slice(0, 300) : null;
    const corrected = applyVerdicts(explanation, verdicts, overall);
    return { applied: true, provider: res.provider, model: res.model, cached: res.cached, explanation: corrected, verdictCount: verdicts.length };
  } catch (err) {
    logger.warn({ err: String(err.message || err) }, 'Critic unavailable — keeping findings (they are already evidence-referenced)');
    return { applied: false, reason: String(err.message || err), explanation };
  }
}

function applyVerdicts(explanation, verdicts, overall) {
  const byId = new Map(verdicts.map((v) => [String(v.id), v]));
  const findings = [];
  for (const f of explanation.findings) {
    const v = byId.get(String(f.id));
    if (!v || v.verdict === 'keep') { findings.push(f); continue; }
    if (v.verdict === 'fix' && v.correctedStatement && typeof v.correctedStatement === 'string') {
      findings.push({ ...f, statement: v.correctedStatement.replace(/[<>`]/g, '').slice(0, 500), limitation: f.limitation || 'Verified statement was corrected by critic.' });
      continue;
    }
    // remove — never display an unverified claim
  }
  return { ...explanation, findings, criticOverall: overall || undefined };
}

module.exports = { critique, shouldCriticize };
