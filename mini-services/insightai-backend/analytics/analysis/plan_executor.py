"""Layer 4 — Deterministic plan execution.

Executes a validated plan against the actual DataFrame. All values are computed
from real data; nothing is invented. Handles nulls, zero denominators and
high-cardinality guards. Output is recharts-friendly.
"""

import pandas as pd
import numpy as np
from scipy import stats as sps


def execute_plan(df, plan, cfg):
    results = {'kpis': [], 'charts': [], 'tests': []}
    for kpi in (plan.get('kpis') or []):
        try:
            results['kpis'].append(_exec_kpi(df, kpi))
        except Exception as e:
            results['kpis'].append({**kpi, 'value': None, 'error': str(e)[:200]})
    for chart in (plan.get('charts') or []):
        try:
            results['charts'].append(_exec_chart(df, chart, cfg))
        except Exception as e:
            results['charts'].append({**chart, 'result': None, 'error': str(e)[:200]})
    for test in (plan.get('tests') or []):
        try:
            results['tests'].append(_exec_test(df, test))
        except Exception as e:
            results['tests'].append({**test, 'result': None, 'error': str(e)[:200]})
    return results


# ─── KPIs ──────────────────────────────────────────────────────────────

def _exec_kpi(df, kpi):
    kind = kpi.get('kind')
    out = {**kpi, 'value': None, 'result': {}}

    if kind == 'aggregate':
        col = kpi['column']
        s = pd.to_numeric(df[col], errors='coerce') if kpi.get('aggregate') not in ('count', 'nunique') else df[col]
        value = _aggregate(s, kpi.get('aggregate', 'sum'))
        out['value'] = _round(value)
        out['result'] = {'sourceColumn': col, 'aggregate': kpi.get('aggregate', 'sum')}

    elif kind == 'grouped':
        g = kpi.get('group') or {}
        by, col, agg = g.get('by'), g.get('column'), g.get('aggregate', 'sum')
        work = df[[by, col]].copy() if col and col != by else df[[by]].copy()
        if col and col != by:
            work[col] = pd.to_numeric(work[col], errors='coerce') if agg not in ('count', 'nunique') else work[col]
        work = work.dropna(subset=[by])
        grouped = work.groupby(by)[col] if (col and col != by) else work.groupby(by)[by]
        if agg == 'count':
            series = work.groupby(by).size()
        else:
            series = grouped.agg(agg)
        series = series.dropna().sort_values(ascending=False).head(int(g.get('limit', 5)))
        total = float(series.sum()) if len(series) and series.dtype != object else None
        groups = [{'name': _fmt(k), 'value': _round(v)} for k, v in series.items()]
        out['value'] = groups[0]['value'] if groups else None
        out['result'] = {'groups': groups, 'total': _round(total)}
        if total:
            for grp in groups:
                grp['share'] = round(grp['value'] / total * 100, 1) if isinstance(grp['value'], (int, float)) else None

    elif kind == 'derived':
        f = kpi.get('formula') or {}
        num = _ref_value(df, f.get('numerator'))
        if f.get('denominator'):
            den = _ref_value(df, f.get('denominator'))
        else:
            den = f.get('value')
        if num is None or den is None:
            out['error'] = 'Formula inputs unavailable (missing or non-numeric source values)'
            return out
        if den == 0:
            out['value'] = None
            out['error'] = 'Zero denominator — derived value undefined for this data'
            out['result'] = {'formula': f, 'numerator': num, 'denominator': den}
            return out
        op = f.get('op')
        if op == 'ratio':
            value = num / den
        elif op == 'difference':
            value = num - den
        elif op == 'multiply':
            value = num * den
        elif op == 'percent_of':
            value = num / den * 100 if den != 0 else None
        else:
            out['error'] = f'Unknown formula op {op}'
            return out
        out['value'] = _round(value)
        out['result'] = {'formula': f, 'numerator': num, 'denominator': den}
    return out


def _ref_value(df, ref):
    if ref is None:
        return None
    if isinstance(ref, (int, float)):
        return float(ref)
    col = ref.get('column')
    if not col or col not in df.columns:
        return None
    agg = ref.get('aggregate', 'sum')
    if agg == 'count':
        s = df[col]
        return float(s.notna().sum())
    if agg == 'nunique':
        return float(df[col].nunique())
    s = pd.to_numeric(df[col], errors='coerce').dropna()
    if len(s) == 0:
        return None
    return _round(_aggregate(s, agg))


def _aggregate(s, agg):
    s = s.dropna()
    if len(s) == 0:
        return None
    if agg == 'sum':
        return float(s.sum())
    if agg == 'mean':
        return float(s.mean())
    if agg == 'median':
        return float(s.median())
    if agg == 'min':
        return float(s.min())
    if agg == 'max':
        return float(s.max())
    if agg == 'count':
        return float(len(s))
    if agg == 'nunique':
        return float(s.nunique())
    return None


# ─── Charts ────────────────────────────────────────────────────────────

def _exec_chart(df, chart, cfg):
    ctype = chart.get('type')
    x = chart.get('x') or {}
    y = chart.get('y') or {}
    series = chart.get('series')
    max_points = int(chart.get('maxPoints', 500))
    limit = int(chart.get('limit', 15))

    xcol, ycol = x.get('column'), y.get('column')
    agg = y.get('aggregate', 'sum') or 'count'
    result = {'data': [], 'xLabel': str(xcol or ''), 'yLabel': _y_label(agg, ycol), 'seriesKeys': None}

    if ctype in ('line', 'area'):
        work = df[[xcol] + ([ycol] if ycol and ycol != xcol else [])].copy()
        work = work.dropna(subset=[xcol])
        if ycol and ycol != xcol and agg not in ('count', 'nunique'):
            work[ycol] = pd.to_numeric(work[ycol], errors='coerce')
        if pd.api.types.is_datetime64_any_dtype(work[xcol]):
            bin = (x.get('bin') or 'month')
            if bin == 'none':
                bin = 'month' if work[xcol].nunique() > 60 else 'day'
            xb = _time_bin(work[xcol], bin)
            work['_x'] = xb
        elif pd.api.types.is_numeric_dtype(work[xcol]):
            work['_x'] = work[xcol]
        else:
            work['_x'] = work[xcol].astype(str)
        if series and series.get('column') and series['column'] in df.columns and series['column'] != xcol:
            scol = series['column']
            work[scol] = work[scol].fillna('Unknown').astype(str)
            top_vals = work[scol].value_counts().head(series.get('max', 8)).index.tolist()
            work = work[work[scol].isin(top_vals)]
            if ycol and ycol != xcol:
                if agg == 'count':
                    pivot = work.pivot_table(index='_x', columns=scol, aggfunc='size', fill_value=0)
                else:
                    pivot = work.pivot_table(index='_x', values=ycol, columns=scol, aggfunc=agg, fill_value=0)
            else:
                pivot = work.pivot_table(index='_x', columns=scol, aggfunc='size', fill_value=0)
            pivot = pivot.sort_index().tail(120)
            keys = list(map(str, pivot.columns))
            data = []
            for idx, row in pivot.iterrows():
                rec = {'x': _fmt(idx)}
                for k in keys:
                    rec[k] = _round(row[k])
                data.append(rec)
            result['data'] = data
            result['seriesKeys'] = keys
        else:
            grouped = work.groupby('_x')
            gser = grouped.size() if (not ycol or ycol == xcol or agg == 'count') else grouped[ycol].agg(agg)
            gser = gser.sort_index()
            if len(gser) > 400:
                gser = gser.tail(400)
            result['data'] = [{'x': _fmt(i), 'y': _round(v)} for i, v in gser.items()]
        if result['data']:
            vals = [r.get('y') for r in result['data'] if isinstance(r.get('y'), (int, float))] or \
                   [v for r in result['data'] for v in r.values() if isinstance(v, (int, float)) and r.get('x')]
            if vals:
                result['extremes'] = {'max': max(vals), 'min': min(vals)}

    elif ctype in ('bar', 'stacked_bar'):
        work = df[[xcol] + ([ycol] if ycol and ycol != xcol else [])].copy()
        work = work.dropna(subset=[xcol])
        work[xcol] = work[xcol].astype(str)
        if series and series.get('column') and series['column'] in df.columns and series['column'] != xcol:
            scol = series['column']
            work[scol] = work[scol].fillna('Unknown').astype(str)
            if ycol and ycol != xcol and agg != 'count':
                work[ycol] = pd.to_numeric(work[ycol], errors='coerce')
                pivot = work.pivot_table(index=xcol, values=ycol, columns=scol, aggfunc=agg, fill_value=0)
            else:
                pivot = work.pivot_table(index=xcol, columns=scol, aggfunc='size', fill_value=0)
            # order by total, keep top N
            totals = pivot.sum(axis=1).sort_values(ascending=False).head(limit)
            pivot = pivot.loc[totals.index]
            keys = list(map(str, pivot.columns))
            data = [{'x': _fmt(i), **{k: _round(row[k]) for k in keys}} for i, row in pivot.iterrows()]
            result['data'] = data
            result['seriesKeys'] = keys
        else:
            if ycol and ycol != xcol:
                if agg not in ('count', 'nunique'):
                    work[ycol] = pd.to_numeric(work[ycol], errors='coerce')
                grouped = work.groupby(xcol)[ycol].agg(agg if agg != 'count' else 'size')
            else:
                grouped = work.groupby(xcol).size()
            grouped = grouped.dropna().sort_values(ascending=False).head(limit)
            result['data'] = [{'x': _fmt(i), 'y': _round(v)} for i, v in grouped.items()]
        if result['data']:
            vals = [r.get('y') for r in result['data'] if isinstance(r.get('y'), (int, float))]
            if not vals:
                vals = [v for r in result['data'] for k, v in r.items() if k != 'x' and isinstance(v, (int, float))]
            if vals:
                result['extremes'] = {'max': max(vals), 'min': min(vals), 'maxLabel': max(result['data'], key=lambda r: (r.get('y') if isinstance(r.get('y'), (int, float)) else -1e18)).get('x')}

    elif ctype in ('pie', 'donut'):
        work = df[[xcol]].dropna()
        counts = work[xcol].astype(str).value_counts().head(limit)
        total = float(counts.sum())
        result['data'] = [{'name': _fmt(i), 'value': int(v), 'share': round(v / total * 100, 1)} for i, v in counts.items()]
        result['extremes'] = {'top': result['data'][0]['name'] if result['data'] else None}

    elif ctype == 'histogram':
        s = pd.to_numeric(df[xcol], errors='coerce').dropna()
        if len(s) == 0:
            result['data'] = []
        else:
            bins = min(30, max(8, int(np.ceil(np.sqrt(len(s))))))
            counts, edges = np.histogram(s, bins=bins)
            data = []
            for i, c in enumerate(counts):
                data.append({'binStart': _round(edges[i]), 'binEnd': _round(edges[i + 1]), 'count': int(c)})
            result['data'] = data
            result['bins'] = bins
            result['extremes'] = {'min': _round(float(s.min())), 'max': _round(float(s.max())), 'mean': _round(float(s.mean()))}

    elif ctype == 'box':
        work = df[[xcol]].copy()
        work[xcol] = pd.to_numeric(work[xcol], errors='coerce')
        work = work.dropna()
        # optional grouping via series column
        if series and series.get('column') and series['column'] in df.columns:
            scol = series['column']
            g = df[[xcol, scol]].copy()
            g[xcol] = pd.to_numeric(g[xcol], errors='coerce')
            g = g.dropna()
            g[scol] = g[scol].fillna('Unknown').astype(str)
            top = g[scol].value_counts().head(6).index.tolist()
            g = g[g[scol].isin(top)]
            data = []
            for name, sub in g.groupby(scol):
                data.append(_box_stats(sub[xcol], _fmt(name)))
            result['data'] = data
        else:
            result['data'] = [_box_stats(work[xcol], str(xcol))]

    elif ctype == 'scatter':
        work = df[[xcol, ycol]].copy()
        work[xcol] = pd.to_numeric(work[xcol], errors='coerce')
        work[ycol] = pd.to_numeric(work[ycol], errors='coerce')
        work = work.dropna()
        total = len(work)
        if total > max_points:
            work = work.sample(max_points, random_state=42)
        result['data'] = [{'x': _round(r[0]), 'y': _round(r[1])} for r in work[[xcol, ycol]].itertuples(index=False, name=None)]
        if total > 1:
            corr = float(work[xcol].corr(work[ycol]))
            result['correlation'] = round(corr, 4) if pd.notna(corr) else None
        result['sampleSize'] = int(len(work))
        result['totalSize'] = int(total)

    return {'id': chart.get('id'), 'type': ctype, 'title': chart.get('title'), 'reason': chart.get('reason'), 'result': result}


def _box_stats(s, name):
    s = s.dropna()
    if len(s) == 0:
        return {'group': name, 'min': None, 'q1': None, 'median': None, 'q3': None, 'max': None, 'count': 0}
    q1, q3 = float(s.quantile(0.25)), float(s.quantile(0.75))
    return {
        'group': name,
        'min': _round(float(s.min())), 'q1': _round(q1), 'median': _round(float(s.median())),
        'q3': _round(q3), 'max': _round(float(s.max())), 'count': int(len(s)),
    }


def _time_bin(s, bin):
    if bin == 'day':
        return s.dt.strftime('%Y-%m-%d')
    if bin == 'week':
        return s.dt.strftime('%G-W%V')
    if bin == 'month':
        return s.dt.strftime('%Y-%m')
    if bin == 'quarter':
        return s.dt.to_period('Q').astype(str)
    if bin == 'year':
        return s.dt.strftime('%Y')
    return s.dt.strftime('%Y-%m')


def _y_label(agg, col):
    if agg == 'count' or not col:
        return 'Count'
    return f'{agg.title()} of {col}'


def _fmt(v):
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (np.integer,)):
        return str(int(v))
    if isinstance(v, (np.floating,)):
        return str(round(float(v), 4))
    return str(v)


def _round(v):
    if v is None:
        return None
    try:
        f = float(v)
        if not np.isfinite(f):
            return None
        return round(f, 4)
    except (TypeError, ValueError):
        return v


# ─── Statistical tests ─────────────────────────────────────────────────

def _exec_test(df, test):
    ttype = test.get('type')
    cols = test.get('columns') or []
    result = {'type': ttype}

    if ttype == 'correlation' and len(cols) >= 2:
        a = pd.to_numeric(df[cols[0]], errors='coerce')
        b = pd.to_numeric(df[cols[1]], errors='coerce')
        mask = a.notna() & b.notna()
        n = int(mask.sum())
        if n < 3:
            result.update({'correlation': None, 'error': 'Not enough paired values'})
        else:
            pearson = float(a[mask].corr(b[mask]))
            spearman = float(a[mask].corr(b[mask], method='spearman'))
            t_stat, p_val = sps.pearsonr(a[mask], b[mask]) if n > 2 else (None, None)
            result.update({
                'correlation': round(pearson, 4),
                'spearman': round(spearman, 4) if pd.notna(spearman) else None,
                'pValue': round(float(p_val), 6) if p_val is not None and pd.notna(p_val) else None,
                'n': n,
                'strength': 'strong' if abs(pearson) >= 0.7 else ('moderate' if abs(pearson) >= 0.4 else ('weak' if abs(pearson) >= 0.2 else 'very weak')),
                'direction': 'positive' if pearson > 0 else 'negative',
            })

    elif ttype == 'ttest':
        num_col = next((c for c in cols if pd.api.types.is_numeric_dtype(df[c]) or pd.api.types.is_numeric_dtype(pd.to_numeric(df[c], errors='coerce'))), None)
        cat_col = next((c for c in cols if c != num_col), None)
        if not num_col or not cat_col:
            result['error'] = 'ttest needs one numeric and one 2-value categorical column'
        else:
            work = df[[num_col, cat_col]].copy()
            work[num_col] = pd.to_numeric(work[num_col], errors='coerce')
            work = work.dropna()
            levels = work[cat_col].astype(str).value_counts().index.tolist()
            if len(levels) != 2:
                result['error'] = f'"{cat_col}" has {len(levels)} levels; ttest requires exactly 2'
            else:
                g1 = work[work[cat_col].astype(str) == levels[0]][num_col]
                g2 = work[work[cat_col].astype(str) == levels[1]][num_col]
                if len(g1) < 2 or len(g2) < 2:
                    result['error'] = 'Not enough values per group'
                else:
                    t_stat, p_val = sps.ttest_ind(g1, g2, equal_var=False)
                    result.update({
                        'column': num_col, 'groupColumn': cat_col,
                        'groupA': {'name': str(levels[0]), 'mean': _round(float(g1.mean())), 'n': int(len(g1))},
                        'groupB': {'name': str(levels[1]), 'mean': _round(float(g2.mean())), 'n': int(len(g2))},
                        'tStatistic': _round(float(t_stat)), 'pValue': _round(float(p_val), 6),
                        'significant': bool(p_val < 0.05),
                    })

    elif ttype == 'chi2' and len(cols) >= 2:
        work = df[cols[:2]].copy()
        work = work.fillna('Unknown').astype(str)
        counts = pd.crosstab(work[cols[0]], work[cols[1]])
        if counts.shape[0] < 2 or counts.shape[1] < 2:
            result['error'] = 'Contingency table too small'
        else:
            chi2, p, dof, _ = sps.chi2_contingency(counts)
            n = counts.values.sum()
            cramers_v = float(np.sqrt(chi2 / (n * (min(counts.shape) - 1)))) if n > 0 else None
            result.update({
                'chi2': _round(float(chi2)), 'pValue': _round(float(p), 6), 'dof': int(dof),
                'cramersV': round(cramers_v, 4) if cramers_v is not None else None,
                'significant': bool(p < 0.05),
                'tableHead': [{'a': str(i), 'b': str(c), 'count': int(counts.loc[i, c])} for i in counts.index[:6] for c in counts.columns[:6]][:24],
            })
    else:
        result['error'] = f'Unsupported test type {ttype}'
    return {'id': test.get('id'), 'type': ttype, 'columns': cols[:3], 'description': test.get('description'), 'result': result}
