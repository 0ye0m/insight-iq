import pandas as pd
import numpy as np
import re
from datetime import datetime


def detect_column_types(df):
    """
    Detect the semantic type of each column.
    Returns a dict: { col_name: 'integer'|'float'|'string'|'boolean'|'datetime'|'categorical' }
    """
    type_map = {}

    for col in df.columns:
        col_data = df[col].dropna()
        if len(col_data) == 0:
            type_map[col] = 'string'
            continue

        dtype = str(df[col].dtype)

        # Check boolean
        if dtype in ('bool', 'boolean'):
            type_map[col] = 'boolean'
            continue

        # Check datetime-like
        if 'datetime' in dtype:
            type_map[col] = 'datetime'
            continue

        # Check integer (incl. nullable Int64, int32, etc.)
        if 'int' in dtype.lower() and 'point' not in dtype.lower():
            type_map[col] = 'integer'
            continue

        # Check float (incl. nullable Float64, float32, etc.)
        if 'float' in dtype.lower():
            type_map[col] = 'float'
            continue

        # For object/string columns, try to infer
        if dtype in ('object', 'string'):
            inferred = _infer_string_column_type(col_data)
            type_map[col] = inferred
            continue

        type_map[col] = 'string'

    return type_map


def _infer_string_column_type(series):
    """
    Infer the semantic type of a string column by sampling values.
    """
    sample = series.head(min(100, len(series)))
    sample = sample[sample != '']
    if len(sample) == 0:
        return 'string'

    # Check boolean-like
    bool_vals = set()
    for v in sample:
        v_str = str(v).lower().strip()
        if v_str in ('true', 'false', 'yes', 'no', '1', '0', 'y', 'n'):
            bool_vals.add(v_str)
    if len(bool_vals) <= 2 and len(bool_vals) > 0 and len(sample) > 2:
        return 'boolean'

    # Check datetime-like
    date_patterns = [
        r'\d{4}-\d{2}-\d{2}',
        r'\d{2}/\d{2}/\d{4}',
        r'\d{2}-\d{2}-\d{4}',
        r'\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)',
    ]
    date_matches = 0
    for v in sample:
        v_str = str(v).strip()
        for pat in date_patterns:
            if re.match(pat, v_str):
                date_matches += 1
                break
    if date_matches / len(sample) > 0.7:
        return 'datetime'

    # Check numeric (integer or float)
    numeric_count = 0
    for v in sample:
        v_str = str(v).strip().replace(',', '')
        try:
            float(v_str)
            numeric_count += 1
        except (ValueError, TypeError):
            pass
    if numeric_count / len(sample) > 0.8:
        # Check if all are integers
        all_int = True
        for v in sample:
            v_str = str(v).strip().replace(',', '')
            try:
                f = float(v_str)
                if f != int(f):
                    all_int = False
                    break
            except (ValueError, TypeError):
                all_int = False
                break
        return 'integer' if all_int else 'float'

    # Check categorical (low unique ratio)
    unique_ratio = series.nunique() / len(series)
    if unique_ratio < 0.3 and series.nunique() <= 30:
        return 'categorical'

    return 'string'
