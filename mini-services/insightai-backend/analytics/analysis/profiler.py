"""Column profiling (Layer 1). Returns a list-formatted profile per column with
semantic types, missingness, cardinality, samples and numeric digests."""

import pandas as pd
import numpy as np


def profile_columns(df, type_map, cfg):
    profiles = []
    for col in df.columns:
        col_data = df[col]
        t = type_map.get(col, 'string')
        non_null = col_data.dropna()
        profile = {
            'name': str(col),
            'dtype': str(col_data.dtype),
            'semanticType': t,
            'totalValues': int(len(col_data)),
            'missingCount': int(col_data.isna().sum()),
            'missingPct': round(float(col_data.isna().mean() * 100), 2) if len(col_data) else 0.0,
            'uniqueCount': int(col_data.nunique()),
            'sampleValues': [str(v) for v in non_null.head(5).tolist()],
            'isConstant': bool(col_data.nunique(dropna=False) <= 1),
            'isIdLike': bool(len(non_null) > 0 and col_data.nunique() / len(non_null) >= 0.95 and (non_null.astype(str).str.fullmatch(r'\d+').mean() >= 0.9 or str(col).lower().endswith('id'))),
        }
        if t in ('integer', 'float'):
            num = pd.to_numeric(col_data, errors='coerce').dropna()
            if len(num):
                profile['min'] = _r(float(num.min()))
                profile['max'] = _r(float(num.max()))
                profile['mean'] = _r(float(num.mean()))
                profile['median'] = _r(float(num.median()))
                profile['std'] = _r(float(num.std())) if len(num) > 1 else 0.0
                profile['sum'] = _r(float(num.sum()))
        if t == 'datetime':
            dt = pd.to_datetime(col_data, errors='coerce').dropna()
            if len(dt):
                profile['min'] = str(dt.min())
                profile['max'] = str(dt.max())
        if profile['uniqueCount'] <= 25:
            vc = col_data.value_counts().head(10)
            profile['topValues'] = [
                {'value': str(v), 'count': int(c), 'percentage': round(c / len(col_data) * 100, 2) if len(col_data) else 0}
                for v, c in vc.items()
            ]
        profiles.append(profile)
    return profiles


def _r(v):
    try:
        f = float(v)
        if not np.isfinite(f):
            return None
        return round(f, 4)
    except (TypeError, ValueError):
        return None


# Backwards-compatible with the original API
def profile_dataset(df, cfg):
    type_map = {}
    from cleaning.type_detection import detect_column_types
    type_map = detect_column_types(df)
    return {p['name']: p for p in profile_columns(df, type_map, cfg)}
