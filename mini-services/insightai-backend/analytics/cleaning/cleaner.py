import pandas as pd
import numpy as np
from .missing_values import handle_missing_values
from .duplicates import detect_and_remove_duplicates
from .type_detection import detect_column_types


def clean_dataframe(df, cfg):
    """
    Full cleaning pipeline:
    1. Strip column names
    2. Strip string whitespace
    3. Handle missing values
    4. Detect and remove duplicates
    Returns (cleaned_df, cleaning_log).
    """
    log = {
        'originalRows': len(df),
        'originalColumns': len(df.columns),
        'steps': [],
    }
    df_clean = df.copy()

    # Step 1: Clean column names
    original_cols = list(df_clean.columns)
    df_clean.columns = [str(c).strip().replace(' ', '_') for c in df_clean.columns]
    renamed = [
        {'from': o, 'to': n}
        for o, n in zip(original_cols, df_clean.columns)
        if o != n
    ]
    if renamed:
        log['steps'].append({'action': 'column_names_normalized', 'details': renamed})

    # Step 2: Strip whitespace from string columns
    str_cols = df_clean.select_dtypes(include=['object', 'string']).columns
    if len(str_cols) > 0:
        for col in str_cols:
            df_clean[col] = df_clean[col].apply(
                lambda x: x.strip() if isinstance(x, str) else x
            )
        log['steps'].append({
            'action': 'string_whitespace_stripped',
            'columnsAffected': len(str_cols),
        })

    # Step 3: Handle missing values
    df_clean, missing_log = handle_missing_values(df_clean, cfg)
    log['steps'].append(missing_log)

    # Step 4: Detect and remove exact duplicates
    df_clean, dup_log = detect_and_remove_duplicates(df_clean)
    log['steps'].append(dup_log)

    log['finalRows'] = len(df_clean)
    log['finalColumns'] = len(df_clean.columns)
    log['rowsRemoved'] = log['originalRows'] - log['finalRows']

    return df_clean, log
