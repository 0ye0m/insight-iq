"""Deterministic data-quality scoring.

Documented, consistent rules. The score measures measurable issues only —
outliers are informational (they may be legitimate values) and never penalized.
Deleting rows does not automatically improve the score; the score is always
recomputed from the actual data.
"""

import pandas as pd
import numpy as np
import re

SEVERITY_ORDER = {'low': 1, 'medium': 2, 'high': 3}


def compute_quality(df, type_map, statistics):
    total_cells = len(df) * max(1, len(df.columns))
    missing_cells = int(df.isna().sum().sum())
    missing_pct = round(missing_cells / total_cells * 100, 2) if total_cells else 0.0
    duplicate_rows = int(df.duplicated().sum())
    duplicate_pct = round(duplicate_rows / len(df) * 100, 2) if len(df) else 0.0

    issues = []
    score = 100.0
    breakdown = {}

    # 1. Missing values — 0.5 pts per % missing, capped at 40
    penalty = min(40.0, missing_pct * 0.5)
    breakdown['missing'] = round(penalty, 2)
    score -= penalty
    if missing_cells > 0:
        worst = df.isna().sum().sort_values(ascending=False).head(3)
        issues.append({
            'id': 'missing_values', 'type': 'missing_values', 'severity': 'high' if missing_pct > 20 else ('medium' if missing_pct > 5 else 'low'),
            'column': ', '.join(str(i) for i in worst.index), 'count': missing_cells,
            'description': f'{missing_cells} missing cells ({missing_pct}% of all cells). Worst: ' + ', '.join(f'{c} ({int(v)})' for c, v in worst.items()),
        })

    # 2. Duplicate rows — 0.3 pts per % duplicates, capped at 20
    penalty = min(20.0, duplicate_pct * 0.3)
    breakdown['duplicates'] = round(penalty, 2)
    score -= penalty
    if duplicate_rows > 0:
        issues.append({
            'id': 'duplicate_rows', 'type': 'duplicate_rows', 'severity': 'medium' if duplicate_pct < 10 else 'high',
            'column': None, 'count': duplicate_rows,
            'description': f'{duplicate_rows} exact duplicate rows ({duplicate_pct}%).',
        })

    # 3. Constant columns — 3 pts each, capped at 9
    constant_cols = [c for c in df.columns if df[c].nunique(dropna=False) <= 1]
    penalty = min(9.0, 3.0 * len(constant_cols))
    breakdown['constant_columns'] = round(penalty, 2)
    score -= penalty
    if constant_cols:
        issues.append({
            'id': 'constant_columns', 'type': 'constant_columns', 'severity': 'low',
            'column': ', '.join(map(str, constant_cols)), 'count': len(constant_cols),
            'description': f'{len(constant_cols)} column(s) with a single constant value: {", ".join(map(str, constant_cols))[:120]}',
        })

    # 4. Mixed-type (text columns that mix parseable numbers and non-numbers)
    mixed_cols = []
    for col in df.columns:
        if type_map.get(col) == 'string':
            sample = df[col].dropna().astype(str)
            if len(sample) < 5:
                continue
            num_like = sample.str.replace(',', '', regex=False).str.strip().apply(_is_numeric)
            frac_num = float(num_like.mean())
            if 0.2 < frac_num < 0.8:
                mixed_cols.append(col)
    penalty = min(15.0, 5.0 * len(mixed_cols))
    breakdown['mixed_types'] = round(penalty, 2)
    score -= penalty
    if mixed_cols:
        issues.append({
            'id': 'mixed_types', 'type': 'mixed_types', 'severity': 'medium',
            'column': ', '.join(map(str, mixed_cols)), 'count': len(mixed_cols),
            'description': f'{len(mixed_cols)} column(s) mix numeric and non-numeric text values: {", ".join(map(str, mixed_cols))[:120]}',
        })

    # 5. Invalid dates in datetime-typed columns
    invalid_dates = 0
    for col, t in type_map.items():
        if t == 'datetime':
            coerced = pd.to_datetime(df[col], errors='coerce')
            invalid = int((coerced.isna() & df[col].notna()).sum())
            invalid_dates += invalid
    if invalid_dates > 0:
        pct = invalid_dates / max(1, len(df)) * 100
        penalty = min(10.0, pct * 0.5)
        breakdown['invalid_dates'] = round(penalty, 2)
        score -= penalty
        issues.append({
            'id': 'invalid_dates', 'type': 'invalid_dates', 'severity': 'medium',
            'column': None, 'count': invalid_dates,
            'description': f'{invalid_dates} value(s) look like dates but failed to parse.',
        })
    else:
        breakdown['invalid_dates'] = 0

    # 6. Whitespace problems in string columns
    ws_cells = 0
    for col in df.columns:
        if type_map.get(col) in ('string', 'categorical'):
            s = df[col].dropna().astype(str)
            ws_cells += int((s != s.str.strip()).sum())
    ws_pct = ws_cells / max(1, total_cells) * 100
    penalty = min(6.0, ws_pct * 0.3)
    breakdown['whitespace'] = round(penalty, 2)
    score -= penalty
    if ws_cells > 0:
        issues.append({
            'id': 'whitespace', 'type': 'whitespace', 'severity': 'low',
            'column': None, 'count': ws_cells,
            'description': f'{ws_cells} value(s) contain leading/trailing whitespace.',
        })
    else:
        breakdown['whitespace'] = 0

    # 7. Suspected outliers (informational only — no score penalty)
    outlier_cols = []
    outlier_count = 0
    for col, t in type_map.items():
        if t in ('integer', 'float'):
            s = pd.to_numeric(df[col], errors='coerce').dropna()
            if len(s) < 8:
                continue
            q1, q3 = s.quantile(0.25), s.quantile(0.75)
            iqr = q3 - q1
            if iqr == 0:
                continue
            n_out = int(((s < q1 - 1.5 * iqr) | (s > q3 + 1.5 * iqr)).sum())
            if n_out > 0:
                outlier_cols.append(col)
                outlier_count += n_out
    breakdown['outliers'] = 0
    if outlier_count > 0:
        issues.append({
            'id': 'outliers', 'type': 'outliers', 'severity': 'low',
            'column': ', '.join(map(str, outlier_cols)), 'count': outlier_count,
            'description': f'{outlier_count} value(s) outside the IQR fence in {", ".join(map(str, outlier_cols))[:100]}. Informational — may be legitimate extreme values.',
        })

    # 8. ID-like columns (informational)
    id_like = [c for c in df.columns if _is_id_like(df[c])]
    if id_like:
        issues.append({
            'id': 'id_like_columns', 'type': 'id_like_columns', 'severity': 'low',
            'column': ', '.join(map(str, id_like)), 'count': len(id_like),
            'description': f'Column(s) look like unique identifiers (not useful as analysis features): {", ".join(map(str, id_like))[:120]}',
        })

    score = max(0.0, round(score, 1))
    return {
        'qualityScore': score,
        'grade': 'A' if score >= 90 else ('B' if score >= 75 else ('C' if score >= 60 else ('D' if score >= 40 else 'F'))),
        'scoreBreakdown': breakdown,
        'missingCells': missing_cells,
        'missingPct': missing_pct,
        'duplicateRows': duplicate_rows,
        'duplicatePct': duplicate_pct,
        'constantColumns': len(constant_cols),
        'mixedTypeColumns': len(mixed_cols),
        'invalidDates': invalid_dates,
        'whitespaceCells': ws_cells,
        'suspectedOutliers': outlier_count,
        'idLikeColumns': id_like,
        'totalRows': int(len(df)),
        'totalColumns': int(len(df.columns)),
        'issues': sorted(issues, key=lambda i: -SEVERITY_ORDER.get(i['severity'], 0)),
    }


def _is_numeric(v):
    try:
        float(str(v).replace(',', '').strip())
        return True
    except (ValueError, TypeError):
        return False


def _is_id_like(series):
    try:
        s = series.dropna()
        if len(s) == 0:
            return False
        uniq = s.nunique()
        if uniq / len(s) < 0.95:
            return False
        sample = s.astype(str).head(100)
        if sample.str.fullmatch(r'\d+').mean() >= 0.95:
            return True
        if sample.str.fullmatch(r'[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}').mean() >= 0.8:
            return True
        name = str(series.name).lower()
        if (('id' in name or name.endswith('_no') or name.endswith('_number')) and uniq / len(s) >= 0.95):
            return True
        return False
    except Exception:
        return False
