"""Operations-based cleaning: propose deterministic operations with affected
counts (preview), then apply only the user-approved subset. The original data
is never mutated — applying creates a new versioned snapshot.
"""

import re
import pandas as pd
import numpy as np

OP_DEFS = {
    'fix_column_names': {'label': 'Normalize column names', 'description': 'Trim and standardize column headers (spaces → underscores).'},
    'strip_whitespace': {'label': 'Trim whitespace', 'description': 'Remove leading/trailing whitespace from text values.'},
    'remove_duplicate_rows': {'label': 'Remove duplicate rows', 'description': 'Drop exact duplicate rows, keeping the first occurrence.'},
    'drop_all_missing_columns': {'label': 'Drop empty columns', 'description': 'Remove columns where every value is missing.'},
    'drop_constant_columns': {'label': 'Drop constant columns', 'description': 'Remove columns with a single repeated value (no analytical signal).'},
    'convert_datetime': {'label': 'Fix date columns', 'description': 'Convert date-like text columns to real datetimes; unparseable values become missing.'},
    'coerce_numeric': {'label': 'Fix numeric columns', 'description': 'Convert numeric-looking text (handles thousand separators) to numbers.'},
    'fill_missing_median': {'label': 'Fill missing numeric values (median)', 'description': 'Impute missing numeric values with the column median — robust to outliers.'},
    'fill_missing_mode': {'label': 'Fill missing categorical values ("Unknown")', 'description': 'Replace missing categorical/text values with an explicit "Unknown" label.'},
    'drop_missing_rows': {'label': 'Drop rows with missing values', 'description': 'Remove rows containing any missing value. Careful: reduces sample size — only sensible when missingness is rare.'},
}


def propose_operations(df, type_map, stats, cfg):
    ops = []

    # fix column names
    bad_cols = [c for c in df.columns if str(c) != str(c).strip() or ' ' in str(c)]
    if bad_cols:
        ops.append(_op('fix_column_names', column=None, affected=len(bad_cols), detail=f'Columns: {", ".join(map(str, bad_cols[:6]))}'))

    # whitespace in text values
    ws_cols = []
    ws_count = 0
    for col in df.columns:
        if type_map.get(col) in ('string', 'categorical'):
            s = df[col].dropna().astype(str)
            n = int((s != s.str.strip()).sum())
            if n > 0:
                ws_cols.append(col)
                ws_count += n
    if ws_count:
        ops.append(_op('strip_whitespace', column=', '.join(map(str, ws_cols[:5])), affected=ws_count, detail=f'{ws_count} values across {len(ws_cols)} column(s)'))

    # duplicates
    dup = int(df.duplicated().sum())
    if dup > 0:
        ops.append(_op('remove_duplicate_rows', column=None, affected=dup, detail=f'{dup} exact duplicate rows ({round(dup / len(df) * 100, 1)}%)'))

    # all-missing columns
    empty_cols = [c for c in df.columns if df[c].isna().all()]
    if empty_cols:
        ops.append(_op('drop_all_missing_columns', column=', '.join(map(str, empty_cols)), affected=len(empty_cols), detail=f'{len(empty_cols)} column(s) entirely empty'))

    # constant columns
    const_cols = [c for c in df.columns if df[c].nunique(dropna=False) <= 1]
    if const_cols:
        ops.append(_op('drop_constant_columns', column=', '.join(map(str, const_cols)), affected=len(const_cols), detail=f'{len(const_cols)} constant column(s)'))

    # datetime conversion candidates
    for col in df.columns:
        if type_map.get(col) == 'string' and _looks_like_dates(df[col]):
            ops.append(_op('convert_datetime', column=col, affected=int(df[col].notna().sum()), detail=f'"{col}" stores dates as text'))

    # numeric coercion candidates
    for col in df.columns:
        if type_map.get(col) == 'string' and _looks_like_numbers(df[col]):
            ops.append(_op('coerce_numeric', column=col, affected=int(df[col].notna().sum()), detail=f'"{col}" stores numbers as text'))

    # missing value handling
    for col in df.columns:
        t = type_map.get(col)
        miss = int(df[col].isna().sum())
        if miss == 0:
            continue
        if t in ('integer', 'float'):
            ops.append(_op('fill_missing_median', column=col, affected=miss, detail=f'{miss} missing value(s) → median'))
        elif t in ('string', 'categorical', 'boolean'):
            ops.append(_op('fill_missing_mode', column=col, affected=miss, detail=f'{miss} missing value(s) → "Unknown"'))

    # drop missing rows (only suggest when rare)
    total_missing_rows = int(df.isna().any(axis=1).sum())
    if 0 < total_missing_rows <= max(50, len(df) * 0.05):
        ops.append(_op('drop_missing_rows', column=None, affected=total_missing_rows, detail=f'{total_missing_rows} row(s) contain missing values ({round(total_missing_rows / len(df) * 100, 1)}%)'))

    return ops


def apply_operations(df, selected_ids, cfg):
    """Apply the selected operations in a fixed, dependency-safe order.
    Returns (list_of_applied_ids, details_dict)."""
    selected = set(selected_ids)
    applied = []
    details = {}

    # 1. column names
    if 'fix_column_names' in selected:
        old = list(df.columns)
        df.columns = [str(c).strip().replace(' ', '_') for c in df.columns]
        renamed = [{'from': o, 'to': n} for o, n in zip(old, df.columns) if o != n]
        if renamed:
            details['fix_column_names'] = {'renamed': renamed}
            applied.append('fix_column_names')

    # NOTE: after renaming, subsequent ops reference NEW names; selected ids that
    # referenced old names are matched by position-safe fallback below.

    # 2. whitespace
    if 'strip_whitespace' in selected:
        n_before = int(df.isna().sum().sum())
        count = 0
        for col in df.columns:
            if _is_text_dtype(df[col]):
                stripped = df[col].apply(lambda x: x.strip() if isinstance(x, str) else x)
                count += int((stripped.fillna('§') != df[col].fillna('§')).sum())
                df[col] = stripped
        details['strip_whitespace'] = {'valuesChanged': count}
        applied.append('strip_whitespace')

    # 3. drop empty/constant columns
    if 'drop_all_missing_columns' in selected:
        empty = [c for c in df.columns if df[c].isna().all()]
        if empty:
            df.drop(columns=empty, inplace=True)
            details['drop_all_missing_columns'] = {'dropped': [str(c) for c in empty]}
            applied.append('drop_all_missing_columns')
    if 'drop_constant_columns' in selected:
        const = [c for c in df.columns if df[c].nunique(dropna=False) <= 1]
        if const:
            df.drop(columns=const, inplace=True)
            details['drop_constant_columns'] = {'dropped': [str(c) for c in const]}
            applied.append('drop_constant_columns')

    # 4. datetime coercion
    if 'convert_datetime' in selected:
        converted = []
        for col in list(df.columns):
            if _is_text_dtype(df[col]) and _looks_like_dates(df[col]):
                parsed = pd.to_datetime(df[col], errors='coerce')
                valid = int(parsed.notna().sum())
                if valid >= int(df[col].notna().sum() * 0.6) and valid > 0:
                    df[col] = parsed
                    converted.append(str(col))
        if converted:
            details['convert_datetime'] = {'converted': converted}
            applied.append('convert_datetime')

    # 5. numeric coercion
    if 'coerce_numeric' in selected:
        converted = []
        for col in list(df.columns):
            if _is_text_dtype(df[col]) and _looks_like_numbers(df[col]):
                cleaned = df[col].astype(str).str.replace(',', '', regex=False).str.strip()
                parsed = pd.to_numeric(cleaned, errors='coerce')
                valid = int(parsed.notna().sum())
                if valid >= int(df[col].notna().sum() * 0.6) and valid > 0:
                    df[col] = parsed
                    converted.append(str(col))
        if converted:
            details['coerce_numeric'] = {'converted': converted}
            applied.append('coerce_numeric')

    # 6. missing values
    if 'fill_missing_median' in selected:
        filled = {}
        for col in df.columns:
            if str(df[col].dtype) in ('float64', 'int64', 'Float64', 'Int64') and df[col].isna().any():
                med = df[col].median()
                df[col] = df[col].fillna(med)
                filled[str(col)] = float(med) if med is not None else None
        if filled:
            details['fill_missing_median'] = {'filled': filled}
            applied.append('fill_missing_median')
    if 'fill_missing_mode' in selected:
        filled = {}
        for col in df.columns:
            if _is_text_dtype(df[col]) and df[col].isna().any():
                df[col] = df[col].fillna('Unknown')
                filled[str(col)] = 'Unknown'
        if filled:
            details['fill_missing_mode'] = {'filled': filled}
            applied.append('fill_missing_mode')

    # 7. duplicate rows
    if 'remove_duplicate_rows' in selected:
        dup = int(df.duplicated().sum())
        if dup > 0:
            df.drop_duplicates(inplace=True, keep='first')
            details['remove_duplicate_rows'] = {'rowsRemoved': dup}
            applied.append('remove_duplicate_rows')

    # 8. drop rows with missing (last — least destructive order first)
    if 'drop_missing_rows' in selected:
        mask = df.isna().any(axis=1)
        n = int(mask.sum())
        if n > 0:
            df.drop(index=df.index[mask], inplace=True)
            df.reset_index(drop=True, inplace=True)
            details['drop_missing_rows'] = {'rowsRemoved': n}
            applied.append('drop_missing_rows')

    return applied, details



def _is_text_dtype(series):
    return pd.api.types.is_object_dtype(series) or pd.api.types.is_string_dtype(series)

def _op(op_id, column, affected, detail):
    return {
        'id': op_id,
        'type': op_id,
        'label': OP_DEFS.get(op_id, {}).get('label', op_id),
        'description': OP_DEFS.get(op_id, {}).get('description', ''),
        'column': column,
        'affectedCount': int(affected or 0),
        'detail': detail,
    }


DATE_PATTERNS = [
    r'^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$',
    r'^\d{1,2}/\d{1,2}/\d{4}$',
    r'^\d{1,2}-\d{1,2}-\d{4}$',
    r'^\d{4}/\d{1,2}/\d{1,2}$',
]


def _looks_like_dates(series, threshold=0.7):
    s = series.dropna().astype(str).head(200)
    if len(s) == 0:
        return False
    hits = 0
    for v in s:
        v = v.strip()
        if any(re.fullmatch(p, v) for p in DATE_PATTERNS):
            hits += 1
    return hits / len(s) >= threshold


def _looks_like_numbers(series, threshold=0.8):
    s = series.dropna().astype(str).head(200)
    if len(s) == 0:
        return False
    hits = 0
    for v in s:
        try:
            float(v.replace(',', '').strip())
            hits += 1
        except (ValueError, TypeError):
            pass
    return hits / len(s) >= threshold
