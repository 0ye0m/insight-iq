"""Dataset comparison: dirty vs cleaned versions, or two different datasets.
All numbers are computed from the actual frames. Column matching is done by
name AND type compatibility — same name does not imply same meaning, so type
mismatches are reported instead of silently compared."""

import pandas as pd
import numpy as np
from cleaning.type_detection import detect_column_types
from analysis.quality import compute_quality
from analysis.statistics import compute_statistics


def compare_datasets(df_a, df_b, label_a, label_b, cfg):
    types_a = detect_column_types(df_a)
    types_b = detect_column_types(df_b)

    cols_a, cols_b = set(df_a.columns), set(df_b.columns)
    common = sorted(cols_a & cols_b)
    only_a = sorted(cols_a - cols_b)
    only_b = sorted(cols_b - cols_a)

    quality_a = compute_quality(df_a, types_a, compute_statistics(df_a, types_a, cfg))
    quality_b = compute_quality(df_b, types_b, compute_statistics(df_b, types_b, cfg))

    # column-level type compatibility
    type_issues = []
    compatible_common = []
    for col in common:
        ta, tb = types_a.get(col), types_b.get(col)
        compat = _compatible(ta, tb)
        compatible_common.append({'column': col, 'typeA': ta, 'typeB': tb, 'compatible': compat})
        if not compat:
            type_issues.append({'column': col, 'typeA': ta, 'typeB': tb})

    # numeric stat deltas on compatible numeric columns
    numeric_compared = []
    for col in common:
        if _compatible(types_a.get(col), types_b.get(col)) and types_a.get(col) in ('integer', 'float'):
            sa = pd.to_numeric(df_a[col], errors='coerce').dropna()
            sb = pd.to_numeric(df_b[col], errors='coerce').dropna()
            if len(sa) == 0 and len(sb) == 0:
                continue
            numeric_compared.append({
                'column': col,
                'countA': int(len(sa)), 'countB': int(len(sb)),
                'meanA': _r(sa.mean()) if len(sa) else None, 'meanB': _r(sb.mean()) if len(sb) else None,
                'meanDelta': _r(sb.mean() - sa.mean()) if len(sa) and len(sb) else None,
                'medianA': _r(sa.median()) if len(sa) else None, 'medianB': _r(sb.median()) if len(sb) else None,
                'minA': _r(sa.min()) if len(sa) else None, 'minB': _r(sb.min()) if len(sb) else None,
                'maxA': _r(sa.max()) if len(sa) else None, 'maxB': _r(sb.max()) if len(sb) else None,
                'stdA': _r(sa.std()) if len(sa) > 1 else None, 'stdB': _r(sb.std()) if len(sb) > 1 else None,
            })

    # missingness deltas per common column
    missingness = []
    for col in common:
        ma = float(df_a[col].isna().mean() * 100)
        mb = float(df_b[col].isna().mean() * 100)
        missingness.append({'column': col, 'missingPctA': round(ma, 2), 'missingPctB': round(mb, 2), 'delta': round(mb - ma, 2)})
    missingness.sort(key=lambda x: -abs(x['delta']))

    # categorical frequency shifts on compatible low-cardinality columns
    categorical_compared = []
    for col in common:
        if _compatible(types_a.get(col), types_b.get(col)) and types_a.get(col) in ('categorical', 'string', 'boolean'):
            ua, ub = df_a[col].nunique(), df_b[col].nunique()
            if ua <= 25 and ub <= 25:
                fa = df_a[col].value_counts(normalize=True)
                fb = df_b[col].value_counts(normalize=True)
                tvd = 0.5 * float((fa.subtract(fb, fill_value=0)).abs().sum())
                categorical_compared.append({
                    'column': col,
                    'uniqueA': int(ua), 'uniqueB': int(ub),
                    'distributionDistance': round(tvd, 4),
                    'topA': [{'value': str(v), 'pct': round(p * 100, 1)} for v, p in fa.head(3).items()],
                    'topB': [{'value': str(v), 'pct': round(p * 100, 1)} for v, p in fb.head(3).items()],
                })
    categorical_compared.sort(key=lambda x: -x['distributionDistance'])

    # date range comparison
    date_compared = []
    for col in common:
        if _compatible(types_a.get(col), types_b.get(col)) and types_a.get(col) == 'datetime':
            da = pd.to_datetime(df_a[col], errors='coerce').dropna()
            db = pd.to_datetime(df_b[col], errors='coerce').dropna()
            date_compared.append({
                'column': col,
                'minA': str(da.min()) if len(da) else None, 'maxA': str(da.max()) if len(da) else None,
                'minB': str(db.min()) if len(db) else None, 'maxB': str(db.max()) if len(db) else None,
            })

    # record matching via a shared id-like column
    record_match = _record_match(df_a, df_b, common, types_a, types_b)

    q_a, q_b = quality_a['qualityScore'], quality_b['qualityScore']
    return {
        'labels': {'a': label_a, 'b': label_b},
        'shape': {
            'rowsA': int(len(df_a)), 'rowsB': int(len(df_b)), 'rowDelta': int(len(df_b) - len(df_a)),
            'colsA': int(len(df_a.columns)), 'colsB': int(len(df_b.columns)), 'colDelta': int(len(df_b.columns) - len(df_a.columns)),
        },
        'quality': {
            'scoreA': q_a, 'scoreB': q_b, 'delta': round(q_b - q_a, 1),
            'gradeA': quality_a['grade'], 'gradeB': quality_b['grade'],
            'missingPctA': quality_a['missingPct'], 'missingPctB': quality_b['missingPct'],
            'duplicateRowsA': quality_a['duplicateRows'], 'duplicateRowsB': quality_b['duplicateRows'],
            'rowsRetained': int(len(df_b)),
        },
        'schema': {
            'commonColumns': compatible_common,
            'onlyInA': [{'column': c, 'type': types_a.get(c)} for c in only_a],
            'onlyInB': [{'column': c, 'type': types_b.get(c)} for c in only_b],
            'typeIssues': type_issues,
        },
        'numeric': numeric_compared[:20],
        'missingness': missingness[:20],
        'categorical': categorical_compared[:12],
        'dates': date_compared,
        'records': record_match,
    }


def _record_match(df_a, df_b, common_cols, types_a, types_b):
    """Match records only when a reliable shared unique key exists.
    Key candidates must be identifier-like: high uniqueness AND (an id-ish name
    or an integer/string type) — datetime columns are not valid record keys."""
    id_cols = []
    for col in common_cols:
        t = types_a.get(col)
        if t == 'datetime':
            continue
        if not _compatible(t, types_b.get(col)):
            continue
        name_l = str(col).lower()
        name_suggests_id = ('id' in name_l.split('_') or name_l.endswith('_id') or name_l == 'id'
                            or name_l.endswith('_no') or name_l.endswith('number') or name_l.endswith('uuid'))
        ok = True
        for dfx in (df_a, df_b):
            s = dfx[col].dropna()
            if len(s) == 0 or s.nunique() / len(s) < 0.9:
                ok = False
                break
        if not ok:
            continue
        if name_suggests_id or t in ('integer', 'string'):
            id_cols.append(col)
    if not id_cols:
        return {'matched': False, 'reason': 'No reliable shared unique-key column found (need a common column with ~unique values in both datasets).'}
    key = id_cols[0]
    keys_a = set(df_a[key].dropna())
    keys_b = set(df_b[key].dropna())
    added = keys_b - keys_a
    removed = keys_a - keys_b
    return {
        'matched': True,
        'keyColumn': str(key),
        'inA': len(keys_a), 'inB': len(keys_b),
        'added': len(added), 'removed': len(removed),
        'common': len(keys_a & keys_b),
        'addedSample': [str(v) for v in list(added)[:5]],
        'removedSample': [str(v) for v in list(removed)[:5]],
    }


def _compatible(ta, tb):
    if ta is None or tb is None:
        return False
    if ta == tb:
        return True
    numeric = ('integer', 'float')
    if ta in numeric and tb in numeric:
        return True
    if 'categorical' in (ta, tb) and 'string' in (ta, tb):
        return True
    return False


def _r(v):
    try:
        f = float(v)
        if not np.isfinite(f):
            return None
        return round(f, 4)
    except (TypeError, ValueError):
        return None
