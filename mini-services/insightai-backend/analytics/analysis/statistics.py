import pandas as pd
import numpy as np


def compute_statistics(df, type_map, cfg):
    """
    Compute descriptive statistics for all columns.
    Numerical: count, mean, median, mode, std, variance, min, max, quartiles, IQR, percentiles.
    Categorical: unique count, frequency, distribution.
    Date: min, max, range.
    """
    stats = {}

    for col in df.columns:
        col_type = type_map.get(col, 'string')
        col_data = df[col].dropna()

        if col_type in ('integer', 'float'):
            stats[col] = _numerical_stats(col_data)
        elif col_type == 'datetime':
            stats[col] = _datetime_stats(col_data)
        elif col_type in ('categorical', 'string', 'boolean'):
            stats[col] = _categorical_stats(col_data, col_type)
        else:
            stats[col] = _categorical_stats(col_data, 'string')

    return stats


def _numerical_stats(series):
    """Compute full descriptive statistics for a numerical column."""
    try:
        numeric = pd.to_numeric(series, errors='coerce').dropna()
        if len(numeric) == 0:
            return {'type': 'numeric', 'error': 'No valid numeric values'}

        q1 = numeric.quantile(0.25)
        q3 = numeric.quantile(0.75)
        iqr = q3 - q1

        result = {
            'type': 'numeric',
            'count': int(len(numeric)),
            'mean': round(float(numeric.mean()), 6),
            'median': round(float(numeric.median()), 6),
            'mode': round(float(numeric.mode().iloc[0]), 6) if len(numeric.mode()) > 0 else None,
            'std': round(float(numeric.std()), 6),
            'variance': round(float(numeric.var()), 6),
            'min': round(float(numeric.min()), 6),
            'max': round(float(numeric.max()), 6),
            'range': round(float(numeric.max() - numeric.min()), 6),
            'q1': round(float(q1), 6),
            'q3': round(float(q3), 6),
            'iqr': round(float(iqr), 6),
            'skewness': round(float(numeric.skew()), 6),
            'kurtosis': round(float(numeric.kurtosis()), 6),
            'percentiles': {
                'p5': round(float(numeric.quantile(0.05)), 6),
                'p10': round(float(numeric.quantile(0.10)), 6),
                'p25': round(float(numeric.quantile(0.25)), 6),
                'p50': round(float(numeric.quantile(0.50)), 6),
                'p75': round(float(numeric.quantile(0.75)), 6),
                'p90': round(float(numeric.quantile(0.90)), 6),
                'p95': round(float(numeric.quantile(0.95)), 6),
            },
            'sum': round(float(numeric.sum()), 6),
        }
        return result
    except Exception as e:
        return {'type': 'numeric', 'error': str(e)}


def _categorical_stats(series, col_type):
    """Compute statistics for categorical/string columns."""
    try:
        str_series = series.astype(str)
        value_counts = str_series.value_counts()
        unique_count = int(str_series.nunique())

        top_categories = []
        display_count = min(20, unique_count)
        for val, count in value_counts.head(display_count).items():
            top_categories.append({
                'value': val,
                'count': int(count),
                'percentage': round(count / len(series) * 100, 2),
            })

        return {
            'type': col_type,
            'count': int(len(series)),
            'uniqueCount': unique_count,
            'topCategories': top_categories,
            'cardinality': 'low' if unique_count <= 10 else ('medium' if unique_count <= 50 else 'high'),
        }
    except Exception as e:
        return {'type': col_type, 'error': str(e)}


def _datetime_stats(series):
    """Compute statistics for datetime columns."""
    try:
        dt_series = pd.to_datetime(series, errors='coerce').dropna()
        if len(dt_series) == 0:
            return {'type': 'datetime', 'error': 'No valid datetime values'}

        min_date = dt_series.min()
        max_date = dt_series.max()

        return {
            'type': 'datetime',
            'count': int(len(dt_series)),
            'uniqueCount': int(dt_series.nunique()),
            'min': str(min_date),
            'max': str(max_date),
            'range': str(max_date - min_date),
            'rangeDays': int((max_date - min_date).days),
        }
    except Exception as e:
        return {'type': 'datetime', 'error': str(e)}
