import pandas as pd
import numpy as np


def detect_and_remove_duplicates(df):
    """
    Detect and remove exact duplicate rows.
    Returns (cleaned_df, log).
    """
    log = {
        'action': 'duplicate_detection',
        'detected': 0,
        'removed': 0,
        'percentage': 0.0,
    }

    original_len = len(df)
    if original_len == 0:
        return df, log

    # Detect exact duplicates
    dup_mask = df.duplicated(keep='first')
    detected = int(dup_mask.sum())

    log['detected'] = detected

    if detected > 0:
        df = df[~dup_mask].reset_index(drop=True)
        log['removed'] = detected
        log['percentage'] = round(detected / original_len * 100, 2)

    return df, log
