import pandas as pd
import numpy as np


def compute_correlations(df, type_map):
    """
    Compute correlations between numerical columns.
    Never claim causation.
    Returns a list of correlation objects sorted by absolute value.
    """
    numeric_cols = [c for c, t in type_map.items() if t in ('integer', 'float')]

    if len(numeric_cols) < 2:
        return []

    # Convert to numeric
    df_numeric = df[numeric_cols].apply(pd.to_numeric, errors='coerce')

    # Compute correlation matrix
    corr_matrix = df_numeric.corr(method='pearson')

    correlations = []
    seen = set()

    for i, col_a in enumerate(corr_matrix.columns):
        for j, col_b in enumerate(corr_matrix.columns):
            if i >= j:
                continue
            pair = tuple(sorted([col_a, col_b]))
            if pair in seen:
                continue
            seen.add(pair)

            val = corr_matrix.iloc[i, j]
            if pd.isna(val):
                continue

            # Classify strength
            abs_val = abs(val)
            if abs_val >= 0.7:
                strength = 'strong'
            elif abs_val >= 0.4:
                strength = 'moderate'
            elif abs_val >= 0.2:
                strength = 'weak'
            else:
                strength = 'very weak'

            correlations.append({
                'columnA': pair[0],
                'columnB': pair[1],
                'correlation': round(float(val), 4),
                'absCorrelation': round(float(abs_val), 4),
                'direction': 'positive' if val > 0 else 'negative',
                'strength': strength,
            })

    # Sort by absolute correlation, descending
    correlations.sort(key=lambda x: x['absCorrelation'], reverse=True)

    # Limit output to top 50 pairs
    return correlations[:50]
