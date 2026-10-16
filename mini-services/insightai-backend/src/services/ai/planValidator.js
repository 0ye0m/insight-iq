'use strict';

/**
 * Layer 3 — Plan validation (deterministic, security-critical).
 * Only allows whitelisted operations, existing columns, valid aggregates,
 * sane chart configurations and supported statistical tests.
 * Never executes model-generated code of any kind.
 */

const VALID_AGGREGATES = new Set(['sum', 'mean', 'median', 'min', 'max', 'count', 'nunique']);
const VALID_CHART_TYPES = new Set(['line', 'area', 'bar', 'stacked_bar', 'pie', 'donut', 'histogram', 'box', 'scatter']);
const VALID_BINS = new Set(['none', 'day', 'week', 'month', 'quarter', 'year']);
const VALID_UNITS = new Set(['number', 'currency', 'percent', 'count', 'days', 'text']);
const VALID_TEST_TYPES = new Set(['correlation', 'ttest', 'chi2']);
const VALID_FORMULA_OPS = new Set(['ratio', 'difference', 'multiply', 'percent_of']);
const MAX_CHART_POINTS = 500;

function sanitizeText(s, max = 300) {
  if (typeof s !== 'string') return '';
  return s.replace(/[<>`]/g, '').slice(0, max);
}

function colInfo(name, profile) {
  return (profile.columns || []).find((c) => c.name === name);
}

function isNumericType(t) {
  return t === 'integer' || t === 'float';
}

function validateRef(ref, profile, errors, path) {
  if (!ref || typeof ref !== 'object') { errors.push(`${path}: missing reference`); return false; }
  const col = ref.column;
  if (typeof col !== 'string' || !colInfo(col, profile)) { errors.push(`${path}: unknown column "${col}"`); return false; }
  if (ref.aggregate !== undefined && ref.aggregate !== null && !VALID_AGGREGATES.has(ref.aggregate)) {
    errors.push(`${path}: invalid aggregate "${ref.aggregate}"`);
    return false;
  }
  const agg = ref.aggregate || 'sum';
  const info = colInfo(col, profile);
  if (agg !== 'count' && agg !== 'nunique' && !isNumericType(info.semanticType)) {
    errors.push(`${path}: aggregate "${agg}" requires a numeric column, "${col}" is ${info.semanticType}`);
    return false;
  }
  return true;
}

function validateKpi(kpi, profile, errors, warnings, idx) {
  const path = `kpis[${idx}]`;
  if (!kpi || typeof kpi !== 'object') { errors.push(`${path}: not an object`); return null; }
  const label = sanitizeText(kpi.label, 80);
  if (!label) { errors.push(`${path}: missing label`); return null; }
  const kind = kpi.kind;
  const out = { id: sanitizeText(kpi.id, 40) || `kpi${idx + 1}`, label, kind, description: sanitizeText(kpi.description, 400), priority: Number(kpi.priority) || 50, unit: VALID_UNITS.has(kpi.unit) ? kpi.unit : 'number' };

  if (kind === 'aggregate') {
    if (!validateRef({ column: kpi.column, aggregate: kpi.aggregate }, profile, errors, path)) return null;
    out.column = kpi.column;
    out.aggregate = VALID_AGGREGATES.has(kpi.aggregate) ? kpi.aggregate : 'sum';
    return out;
  }
  if (kind === 'grouped') {
    const g = kpi.group || {};
    if (typeof g.by !== 'string' || !colInfo(g.by, profile)) { errors.push(`${path}: unknown group column "${g.by}"`); return null; }
    const byInfo = colInfo(g.by, profile);
    if (isNumericType(byInfo.semanticType) && byInfo.uniqueCount > 30) {
      warnings.push(`${path}: grouping by high-cardinality numeric column "${g.by}" may not be meaningful`);
    }
    if (!validateRef({ column: g.column, aggregate: g.aggregate }, profile, errors, `${path}.group`)) return null;
    out.group = { by: g.by, column: g.column, aggregate: VALID_AGGREGATES.has(g.aggregate) ? g.aggregate : 'sum', limit: Math.min(Math.max(parseInt(g.limit, 10) || 5, 1), 20) };
    return out;
  }
  if (kind === 'derived') {
    const f = kpi.formula || {};
    if (!VALID_FORMULA_OPS.has(f.op)) { errors.push(`${path}: invalid formula op "${f.op}"`); return null; }
    if (!f.numerator || !validateRef(f.numerator, profile, errors, `${path}.formula.numerator`)) return null;
    if (f.denominator !== undefined) {
      if (typeof f.denominator === 'object' && f.denominator !== null && !f.denominator.value) {
        if (!validateRef(f.denominator, profile, errors, `${path}.formula.denominator`)) return null;
      }
    } else if (f.value === undefined) {
      errors.push(`${path}: formula needs denominator or value`);
      return null;
    }
    out.formula = { op: f.op, numerator: { column: f.numerator.column, aggregate: f.numerator.aggregate || 'sum' } };
    if (f.denominator && typeof f.denominator === 'object' && f.denominator.column) {
      out.formula.denominator = { column: f.denominator.column, aggregate: f.denominator.aggregate || 'sum' };
    } else if (typeof f.denominator === 'number' || typeof f.value === 'number') {
      const v = typeof f.denominator === 'number' ? f.denominator : f.value;
      if (!isFinite(v) || v === 0) { errors.push(`${path}: formula constant must be non-zero finite`); return null; }
      out.formula.value = v;
    } else {
      errors.push(`${path}: formula missing denominator`);
      return null;
    }
    return out;
  }
  errors.push(`${path}: unknown kind "${kind}"`);
  return null;
}

function validateChart(chart, profile, errors, warnings, idx) {
  const path = `charts[${idx}]`;
  if (!chart || typeof chart !== 'object') { errors.push(`${path}: not an object`); return null; }
  const type = chart.type;
  if (!VALID_CHART_TYPES.has(type)) { errors.push(`${path}: unsupported chart type "${type}"`); return null; }
  const title = sanitizeText(chart.title, 120) || `${type} chart`;
  const x = chart.x || {};
  const y = chart.y || {};
  const xName = typeof x.column === 'string' ? x.column : null;
  const yName = typeof y.column === 'string' ? y.column : null;

  if (!xName || !colInfo(xName, profile)) { errors.push(`${path}: unknown x column "${xName}"`); return null; }
  const xInfo = colInfo(xName, profile);
  const bin = VALID_BINS.has(x.bin) ? x.bin : 'none';

  // temporal charts require datetime x (binned) or numeric x
  if ((type === 'line' || type === 'area') && !(xInfo.semanticType === 'datetime' || isNumericType(xInfo.semanticType))) {
    errors.push(`${path}: "${type}" needs a datetime or numeric x-axis, "${xName}" is ${xInfo.semanticType}`);
    return null;
  }
  if ((type === 'line' || type === 'area') && xInfo.semanticType === 'datetime' && bin === 'none' && xInfo.uniqueCount > 400) {
    warnings.push(`${path}: time axis has ${xInfo.uniqueCount} distinct values; auto-binning will be applied`);
  }

  if (type === 'histogram' || type === 'box') {
    if (!isNumericType(xInfo.semanticType)) { errors.push(`${path}: "${type}" requires a numeric column`); return null; }
  }
  if (type === 'scatter') {
    if (!yName || !colInfo(yName, profile)) { errors.push(`${path}: scatter needs a y column`); return null; }
    if (!isNumericType(xInfo.semanticType) || !isNumericType(colInfo(yName, profile).semanticType)) {
      errors.push(`${path}: scatter requires two numeric columns`); return null;
    }
  }
  if ((type === 'pie' || type === 'donut') && xInfo.uniqueCount > 12) {
    errors.push(`${path}: pie/donut rejected — "${xName}" has ${xInfo.uniqueCount} categories (max 12)`);
    return null;
  }

  if (type !== 'histogram' && type !== 'box' && type !== 'scatter') {
    // y must be a valid aggregate of an existing numeric column, or count
    if (!validateRef({ column: yName, aggregate: y.aggregate === 'count' ? 'count' : y.aggregate }, profile, errors, `${path}.y`)) return null;
  }

  let series = null;
  if (chart.series && typeof chart.series.column === 'string') {
    const sName = chart.series.column;
    const sInfo = colInfo(sName, profile);
    if (!sInfo) { warnings.push(`${path}: unknown series column "${sName}" ignored`); }
    else if (sInfo.uniqueCount > 8) { warnings.push(`${path}: series column "${sName}" has ${sInfo.uniqueCount} values; capped at 8`); series = { column: sName, max: 8 }; }
    else series = { column: sName, max: sInfo.uniqueCount };
  }

  return {
    id: sanitizeText(chart.id, 40) || `chart${idx + 1}`,
    type, title,
    reason: sanitizeText(chart.reason, 300),
    x: { column: xName, bin },
    y: { column: yName, aggregate: VALID_AGGREGATES.has(y.aggregate) ? y.aggregate : (yName ? 'sum' : 'count') },
    series,
    limit: Math.min(Math.max(parseInt(chart.limit, 10) || 15, 2), 60),
    priority: Number(chart.priority) || 50,
    maxPoints: MAX_CHART_POINTS,
  };
}

function validateTest(test, profile, errors, warnings, idx) {
  const path = `tests[${idx}]`;
  if (!test || typeof test !== 'object') { errors.push(`${path}: not an object`); return null; }
  const type = test.type;
  if (!VALID_TEST_TYPES.has(type)) { errors.push(`${path}: unsupported test "${type}"`); return null; }
  const cols = Array.isArray(test.columns) ? test.columns : [];
  const infos = cols.map((c) => (typeof c === 'string' ? colInfo(c, profile) : null));
  if (infos.some((i) => !i)) { errors.push(`${path}: unknown column in ${JSON.stringify(cols)}`); return null; }
  if (type === 'correlation' || type === 'ttest') {
    if (!infos.every((i) => isNumericType(i.semanticType))) {
      // ttest allows numeric + categorical — handled below
      if (!(type === 'ttest' && infos.some((i) => !isNumericType(i.semanticType)) && infos.some((i) => isNumericType(i.semanticType)))) {
        errors.push(`${path}: ${type} needs numeric columns`); return null;
      }
    }
  }
  if (type === 'ttest') {
    const cat = infos.find((i) => !isNumericType(i.semanticType));
    if (cat && cat.uniqueCount !== 2) { errors.push(`${path}: ttest grouping column must have exactly 2 values, "${cat.name}" has ${cat.uniqueCount}`); return null; }
  }
  if (type === 'chi2') {
    if (infos.length !== 2 || infos.some((i) => i.uniqueCount > 25)) { errors.push(`${path}: chi2 needs 2 low-cardinality categorical columns`); return null; }
  }
  return { id: sanitizeText(test.id, 40) || `t${idx + 1}`, type, columns: cols.slice(0, 3), description: sanitizeText(test.description, 300) };
}

/**
 * Validate and repair a plan. Returns { plan, valid, repairs[], warnings[] }.
 * Invalid entries are dropped (and optionally sent back to the model once by the caller).
 */
function validatePlan(plan, profile) {
  const errors = [];
  const warnings = [];
  const repairs = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { plan: null, valid: false, repairs: ['plan is not an object'], warnings };
  }

  const clean = {
    objectives: (Array.isArray(plan.objectives) ? plan.objectives : []).slice(0, 6).map((o) => sanitizeText(o, 200)),
    datasetSummary: sanitizeText(plan.datasetSummary, 600),
    kpis: [],
    charts: [],
    tests: [],
    cleaningFocus: (Array.isArray(plan.cleaningFocus) ? plan.cleaningFocus : []).slice(0, 8).map((c) => sanitizeText(c, 80)),
    notes: sanitizeText(plan.notes, 800),
  };

  (Array.isArray(plan.kpis) ? plan.kpis : []).slice(0, 12).forEach((kpi, i) => {
    const before = errors.length;
    const v = validateKpi(kpi, profile, errors, warnings, i);
    if (!v) repairs.push(`kpi "${(kpi && kpi.label) || i}": ${errors.slice(before).join('; ') || 'invalid'}`);
    else clean.kpis.push(v);
  });
  (Array.isArray(plan.charts) ? plan.charts : []).slice(0, 10).forEach((chart, i) => {
    const before = errors.length;
    const v = validateChart(chart, profile, errors, warnings, i);
    if (!v) repairs.push(`chart "${(chart && chart.title) || i}": ${errors.slice(before).join('; ') || 'invalid'}`);
    else clean.charts.push(v);
  });
  (Array.isArray(plan.tests) ? plan.tests : []).slice(0, 5).forEach((test, i) => {
    const before = errors.length;
    const v = validateTest(test, profile, errors, warnings, i);
    if (!v) repairs.push(`test "${(test && test.type) || i}": ${errors.slice(before).join('; ') || 'invalid'}`);
    else clean.tests.push(v);
  });

  clean.kpis.sort((a, b) => a.priority - b.priority);
  clean.charts.sort((a, b) => a.priority - b.priority);

  return { plan: clean, valid: clean.kpis.length > 0 || clean.charts.length > 0, repairs, warnings, errors };
}

module.exports = { validatePlan, VALID_CHART_TYPES };
