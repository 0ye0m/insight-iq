'use strict';

/**
 * Layer 2 — AI analysis planner.
 * Receives the deterministic profile digest (schema + aggregates + samples, NOT the
 * full dataset) and the user's optional objective, and returns a structured plan:
 * { objectives, datasetSummary, kpis[], charts[], tests[], cleaningFocus[], notes }
 */

const { cachedRunJSON } = require('./aiCache');
const logger = require('../../utils/logger');

const PLANNER_SYSTEM = `You are InsightIQ's analysis planner. You receive a deterministic profile of a dataset (schema, per-column statistics, quality issues, correlations, sample rows) and an optional user objective.

Your job: decide WHAT is worth analyzing for THIS dataset — nothing generic.

Rules:
1. Only reference columns that exist in the provided schema. Never invent columns.
2. Propose 4-8 KPIs that are meaningful for this data. Prefer business-meaningful metrics (totals, averages, rates, growth, contribution by segment) that the columns can support. Include at most 2 derived KPIs using "formula" (only ratio/difference/multiply/percent_of between existing numeric aggregates).
3. Propose 3-6 charts that best answer likely questions about this data. Choose chart types strictly appropriate: "line"/"area" only for a datetime (or ordered numeric) x-axis; "bar"/"stacked_bar" for category comparisons; "histogram"/"box" for numeric distributions; "scatter" for numeric vs numeric relationships; "pie"/"donut" only for composition with <=8 categories; "heatmap" only for correlation-style matrices.
4. Propose 0-3 statistical tests only when justified by column types and sample size (correlation needs 2 numeric columns; ttest needs a numeric column and a 2-value categorical; chi2 needs 2 low-cardinality categoricals).
5. List cleaning focus areas based ONLY on reported quality issues.
6. If the objective cannot be addressed with available columns, say so in "notes" and plan what CAN be done.

Respond with ONLY valid JSON:
{
  "objectives": ["string", ...],
  "datasetSummary": "2-3 sentences about what this dataset appears to contain",
  "kpis": [{"id":"kpi1","label":"Human label","kind":"aggregate","column":"col","aggregate":"sum|mean|median|min|max|count|nunique","unit":"number|currency|percent|count","description":"why meaningful","priority":1,
            OR "kind":"derived","formula":{"op":"ratio|difference|multiply|percent_of","numerator":{"column":..,"aggregate":..},"denominator":{"column":..,"aggregate":..} | "value":N},"description":"formula explanation","priority":N,
            OR "kind":"grouped","group":{"by":"col","column":"col","aggregate":"sum|mean|count|min|max|nunique","limit":5},"description":"...","priority":N}],
  "charts": [{"id":"chart1","type":"line|area|bar|stacked_bar|pie|donut|histogram|box|scatter","title":"...","reason":"why this chart answers the objective","x":{"column":"col","bin":"none|day|week|month|quarter|year"},"y":{"column":"col","aggregate":"sum|mean|count|min|max|median|nunique|none"},"series":{"column":"col"}|null,"limit":15,"priority":1}],
  "tests": [{"id":"t1","type":"correlation|ttest|chi2","columns":["a","b"],"description":"..."}],
  "cleaningFocus": ["issue ids or area names"],
  "notes": "caveats, missing information, or 'objective not addressable' explanation"
}`;

function buildProfileDigest(profile, objective, category) {
  const digest = {
    datasetKind: category,
    rowCount: profile.rowCount,
    colCount: profile.colCount,
    columns: (profile.columns || []).map((c) => ({
      name: c.name,
      semanticType: c.semanticType,
      dtype: c.dtype,
      missingPct: c.missingPct,
      uniqueCount: c.uniqueCount,
      sampleValues: (c.sampleValues || []).slice(0, 4),
      min: c.min, max: c.max, mean: c.mean,
      isConstant: c.isConstant, isIdLike: c.isIdLike,
    })),
    quality: profile.quality ? {
      missingCells: profile.quality.missingCells,
      duplicateRows: profile.quality.duplicateRows,
      issues: (profile.quality.issues || []).slice(0, 12).map((i) => ({ id: i.id, type: i.type, severity: i.severity, column: i.column, count: i.count })),
    } : null,
    topCorrelations: (profile.correlations || []).slice(0, 6).map((c) => ({ a: c.columnA, b: c.columnB, r: c.correlation })),
    timeRange: profile.timeRange || null,
    samples: (profile.samples || []).slice(0, 4),
  };
  return digest;
}

function buildPlannerUserPrompt(profile, objective, category) {
  const digest = buildProfileDigest(profile, objective, category);
  return `DATASET PROFILE (computed deterministically, treat as ground truth):
${JSON.stringify(digest, null, 1)}

USER OBJECTIVE: ${objective && objective.trim() ? objective.trim() : '(none given — plan the most generally useful analysis for this data)'}

Produce the analysis plan JSON now.`;
}

/**
 * Returns { plan, provider, model, cached, aiError? }
 * Falls back to null plan if no AI provider is available (deterministic fallback handles it).
 */
async function generatePlan(profile, objective, category, versionHash) {
  const payload = { op: 'plan', hash: versionHash, objective: objective || '', digest: buildProfileDigest(profile, objective, category) };
  try {
    const res = await cachedRunJSON('plan', 'planner', payload, {
      system: PLANNER_SYSTEM,
      user: buildPlannerUserPrompt(profile, objective, category),
      temperature: 0.2,
      maxTokens: 3500,
      label: 'planner',
    });
    return { plan: res.data, provider: res.provider, model: res.model, cached: res.cached };
  } catch (err) {
    logger.warn({ err: String(err.message || err) }, 'Planner unavailable — will use deterministic fallback plan');
    return { plan: null, provider: null, model: null, aiError: String(err.message || err) };
  }
}

module.exports = { generatePlan, buildProfileDigest };
