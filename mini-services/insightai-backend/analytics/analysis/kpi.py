import pandas as pd
import numpy as np


def generate_kpis(df, type_map, statistics):
    """
    Generate meaningful KPIs based on actual data.
    Never invent unsupported business KPIs.
    """
    kpis = []

    # General dataset KPIs
    kpis.append({
        'label': 'Total Records',
        'value': len(df),
        'type': 'number',
        'importance': 'high',
    })
    kpis.append({
        'label': 'Total Columns',
        'value': len(df.columns),
        'type': 'number',
        'importance': 'medium',
    })

    # Count by type
    type_counts = {}
    for col, t in type_map.items():
        type_counts[t] = type_counts.get(t, 0) + 1

    for t, count in type_counts.items():
        kpis.append({
            'label': f'{t.title()} Columns',
            'value': count,
            'type': 'number',
            'importance': 'medium',
        })

    # Missing values KPI
    total_missing = int(df.isna().sum().sum())
    total_cells = len(df) * len(df.columns)
    missing_pct = round(total_missing / total_cells * 100, 2) if total_cells > 0 else 0

    kpis.append({
        'label': 'Missing Values',
        'value': total_missing,
        'type': 'number',
        'importance': 'high' if total_missing > 0 else 'low',
        'subtitle': f'{missing_pct}% of all cells',
    })

    kpis.append({
        'label': 'Data Completeness',
        'value': round(100 - missing_pct, 2),
        'type': 'percentage',
        'importance': 'high',
    })

    # KPIs for numerical columns
    for col, t in type_map.items():
        if t in ('integer', 'float') and col in statistics:
            col_stats = statistics[col]
            if 'error' in col_stats:
                continue

            # Total/Sum KPI
            if 'sum' in col_stats:
                kpis.append({
                    'label': f'Total {col}',
                    'value': col_stats['sum'],
                    'type': 'number',
                    'column': col,
                    'importance': 'medium',
                })

            # Average KPI
            kpis.append({
                'label': f'Average {col}',
                'value': col_stats['mean'],
                'type': 'number',
                'column': col,
                'importance': 'high',
            })

            # Min/Max
            kpis.append({
                'label': f'Min {col}',
                'value': col_stats['min'],
                'type': 'number',
                'column': col,
                'importance': 'low',
            })
            kpis.append({
                'label': f'Max {col}',
                'value': col_stats['max'],
                'type': 'number',
                'column': col,
                'importance': 'low',
            })

    # KPIs for categorical columns
    for col, t in type_map.items():
        if t in ('categorical', 'string') and col in statistics:
            col_stats = statistics[col]
            if 'topCategories' in col_stats and col_stats['topCategories']:
                top = col_stats['topCategories'][0]
                kpis.append({
                    'label': f'Most Common {col}',
                    'value': top['value'],
                    'type': 'text',
                    'column': col,
                    'importance': 'medium',
                    'subtitle': f"{top['count']} occurrences ({top['percentage']}%)",
                })

    # Growth/change KPI for datetime columns
    date_cols = [c for c, t in type_map.items() if t == 'datetime']
    numeric_cols = [c for c, t in type_map.items() if t in ('integer', 'float')]

    if date_cols and numeric_cols:
        date_col = date_cols[0]
        num_col = numeric_cols[0]
        try:
            df_sorted = df.sort_values(date_col)
            if len(df_sorted) >= 2:
                first_val = pd.to_numeric(df_sorted[num_col].iloc[0], errors='coerce')
                last_val = pd.to_numeric(df_sorted[num_col].iloc[-1], errors='coerce')
                if pd.notna(first_val) and pd.notna(last_val) and first_val != 0:
                    change_pct = round((last_val - first_val) / abs(first_val) * 100, 2)
                    kpis.append({
                        'label': f'{num_col} Change',
                        'value': change_pct,
                        'type': 'percentage',
                        'importance': 'high',
                        'subtitle': f'First to last (by {date_col})',
                    })
        except Exception:
            pass

    return kpis
