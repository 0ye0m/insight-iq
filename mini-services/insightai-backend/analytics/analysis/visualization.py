import pandas as pd
import numpy as np


def generate_visualizations(df, type_map, statistics, cfg):
    """
    Generate Chart.js-compatible visualization data.
    Uses deterministic rules for chart type recommendation.
    Returns a list of chart objects.
    """
    charts = []
    chart_count = 0
    max_charts = 10

    # Identify column types
    date_cols = [c for c, t in type_map.items() if t == 'datetime']
    numeric_cols = [c for c, t in type_map.items() if t in ('integer', 'float')]
    categorical_cols = [c for c, t in type_map.items() if t in ('categorical', 'boolean')]
    string_cols = [c for c, t in type_map.items() if t == 'string']

    # Use low-cardinality string columns as categorical
    for c in string_cols:
        if c in statistics and statistics[c].get('cardinality') in ('low', 'medium'):
            if statistics[c].get('uniqueCount', 100) <= 15:
                categorical_cols.append(c)

    # 1. datetime + numeric -> line chart
    if date_cols and numeric_cols and chart_count < max_charts:
        date_col = date_cols[0]
        for num_col in numeric_cols[:3]:
            if chart_count >= max_charts:
                break
            chart = _build_line_chart(df, date_col, num_col)
            if chart:
                charts.append(chart)
                chart_count += 1

    # 2. categorical + numeric -> bar chart
    if categorical_cols and numeric_cols and chart_count < max_charts:
        for cat_col in categorical_cols[:3]:
            for num_col in numeric_cols[:2]:
                if chart_count >= max_charts:
                    break
                chart = _build_bar_chart(df, cat_col, num_col)
                if chart:
                    charts.append(chart)
                    chart_count += 1
            if chart_count >= max_charts:
                break

    # 3. single categorical distribution -> pie/doughnut
    if categorical_cols and chart_count < max_charts:
        for cat_col in categorical_cols[:2]:
            if chart_count >= max_charts:
                break
            unique = df[cat_col].nunique()
            if 2 <= unique <= 8:
                chart = _build_pie_chart(df, cat_col)
                if chart:
                    charts.append(chart)
                    chart_count += 1

    # 4. Correlation heatmap data
    if len(numeric_cols) >= 2 and len(numeric_cols) <= 15 and chart_count < max_charts:
        chart = _build_correlation_chart(df, numeric_cols)
        if chart:
            charts.append(chart)
            chart_count += 1

    return charts


def _safe_label(val):
    """Convert a value to a safe chart label."""
    if pd.isna(val):
        return 'N/A'
    if isinstance(val, float) and val != int(val):
        return str(round(val, 2))
    return str(val)[:30]


def _build_line_chart(df, x_col, y_col):
    """Build a line chart for datetime + numeric data."""
    try:
        df_temp = df[[x_col, y_col]].copy()
        df_temp[x_col] = pd.to_datetime(df_temp[x_col], errors='coerce')
        df_temp[y_col] = pd.to_numeric(df_temp[y_col], errors='coerce')
        df_temp = df_temp.dropna().sort_values(x_col)

        # Aggregate by date if too many points
        if len(df_temp) > 100:
            df_temp[x_col] = df_temp[x_col].dt.date
            df_agg = df_temp.groupby(x_col)[y_col].mean().reset_index()
        else:
            df_agg = df_temp

        if len(df_agg) < 2:
            return None

        labels = [_safe_label(v) for v in df_agg[x_col]]
        values = [round(float(v), 4) if pd.notna(v) else 0 for v in df_agg[y_col]]

        return {
            'type': 'line',
            'title': f'{y_col} over {x_col}',
            'data': {
                'labels': labels,
                'datasets': [{
                    'label': y_col,
                    'data': values,
                    'borderColor': 'rgba(54, 162, 235, 1)',
                    'backgroundColor': 'rgba(54, 162, 235, 0.2)',
                    'fill': True,
                    'tension': 0.3,
                }],
            },
        }
    except Exception:
        return None


def _build_bar_chart(df, cat_col, num_col):
    """Build a bar chart for categorical + numeric data."""
    try:
        df_temp = df[[cat_col, num_col]].copy()
        df_temp[num_col] = pd.to_numeric(df_temp[num_col], errors='coerce')
        df_temp = df_temp.dropna()

        # Aggregate: mean per category
        grouped = df_temp.groupby(cat_col)[num_col].mean().reset_index()
        grouped = grouped.sort_values(num_col, ascending=False).head(20)

        if len(grouped) < 1:
            return None

        labels = [_safe_label(v) for v in grouped[cat_col]]
        values = [round(float(v), 4) if pd.notna(v) else 0 for v in grouped[num_col]]

        # Generate colors
        colors = []
        for i in range(len(labels)):
            hue = (i * 137.508) % 360
            colors.append(f'hsla({hue}, 70%, 55%, 0.8)')

        return {
            'type': 'bar',
            'title': f'{num_col} by {cat_col}',
            'data': {
                'labels': labels,
                'datasets': [{
                    'label': f'Avg {num_col}',
                    'data': values,
                    'backgroundColor': colors,
                }],
            },
        }
    except Exception:
        return None


def _build_pie_chart(df, cat_col):
    """Build a pie chart for categorical distribution."""
    try:
        value_counts = df[cat_col].value_counts().head(8)
        if len(value_counts) < 2:
            return None

        labels = [_safe_label(v) for v in value_counts.index]
        values = [int(v) for v in value_counts.values]

        # Generate distinct colors
        colors = []
        for i in range(len(labels)):
            hue = (i * 360 / len(labels)) % 360
            colors.append(f'hsla({hue}, 65%, 55%, 0.85)')

        chart_type = 'doughnut' if len(labels) <= 6 else 'pie'

        return {
            'type': chart_type,
            'title': f'Distribution of {cat_col}',
            'data': {
                'labels': labels,
                'datasets': [{
                    'data': values,
                    'backgroundColor': colors,
                }],
            },
        }
    except Exception:
        return None


def _build_correlation_chart(df, numeric_cols):
    """Build correlation matrix data for a heatmap-like visualization."""
    try:
        df_numeric = df[numeric_cols].apply(pd.to_numeric, errors='coerce')
        corr = df_numeric.corr()

        # Return as matrix for frontend heatmap rendering
        labels = list(corr.columns)
        matrix = []
        for i, row in enumerate(labels):
            row_data = []
            for j, col in enumerate(labels):
                val = corr.iloc[i, j]
                row_data.append(round(float(val), 4) if pd.notna(val) else 0)
            matrix.append(row_data)

        return {
            'type': 'correlation_matrix',
            'title': 'Correlation Matrix',
            'data': {
                'labels': labels,
                'matrix': matrix,
            },
        }
    except Exception:
        return None