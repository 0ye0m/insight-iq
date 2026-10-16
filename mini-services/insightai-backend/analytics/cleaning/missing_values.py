import pandas as pd
import numpy as np


# Extended missing-value representations
EXTRA_MISSING = [
    'null', 'NULL', 'None', 'none', 'NaN', 'nan', 'NAN',
    'NA', 'na', 'N/A', 'n/a', 'n.a.', '-', '--',
    'empty', 'EMPTY', '?', '???',
    'unknown', 'Unknown', 'UNKNOWN',
    'missing', 'Missing', 'MISSING',
    'nul', 'NUL', '#N/A', '#REF!', '#DIV/0!',
    '#VALUE!', '#NAME?', '#NULL!', '#NUM!',
]


def handle_missing_values(df, cfg):
    """
    Detect and handle missing values.
    - Numerical columns: fill with median
    - Categorical-like columns: fill with mode
    - If mode is ambiguous, fill with 'Unknown'
    Returns (cleaned_df, log).
    """
    log = {
        'action': 'missing_values_handled',
        'totalMissing': 0,
        'columnsHandled': [],
    }

    # First, replace common string representations of missing with NaN
    for col in df.select_dtypes(include=['object', 'string']).columns:
        mask = df[col].isin(EXTRA_MISSING)
        if mask.any():
            df.loc[mask, col] = np.nan
            log['totalMissing'] += int(mask.sum())

    # Count missing per column
    missing_per_col = df.isna().sum()
    total_missing = int(missing_per_col.sum())
    log['totalMissing'] += total_missing

    if total_missing == 0:
        return df, log

    # Handle each column with missing values
    for col in df.columns:
        col_missing = int(missing_per_col.get(col, 0))
        if col_missing == 0:
            continue

        col_data = df[col]
        fill_value = None
        strategy = None

        if pd.api.types.is_numeric_dtype(col_data):
            # Numerical: use median
            fill_value = col_data.median()
            strategy = 'median'
        else:
            # Categorical-like: use mode
            mode_result = col_data.mode()
            if len(mode_result) > 0:
                fill_value = mode_result.iloc[0]
                strategy = 'mode'
            else:
                fill_value = 'Unknown'
                strategy = 'constant_Unknown'

        if fill_value is not None and not (isinstance(fill_value, float) and np.isnan(fill_value)):
            df[col] = col_data.fillna(fill_value)
            log['columnsHandled'].append({
                'column': col,
                'missingCount': col_missing,
                'percentage': round(col_missing / len(df) * 100, 2),
                'strategy': strategy,
            })

    return df, log
