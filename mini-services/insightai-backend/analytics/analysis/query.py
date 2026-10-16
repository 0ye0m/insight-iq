"""Grounded deterministic query answering for chat (Layer 8 backend).

Parses the question with regex patterns into a small set of safe, whitelisted
intents (aggregate / group / topN / trend / correlation / distribution /
missing / duplicates / schema). If nothing matches, returns resolved=False and
the LLM answers from the profile digest only — never from invented numbers.
"""

import re
import pandas as pd
import numpy as np


def answer_query(df, question, type_map, stats, cfg):
    q = question.strip().lower()
    if not q:
        return {'resolved': False}

    numeric_cols = [c for c, t in type_map.items() if t in ('integer', 'float')]
    date_cols = [c for c, t in type_map.items() if t == 'datetime']
    cat_cols = [c for c, t in type_map.items() if t in ('categorical', 'string', 'boolean')]

    # schema / metadata
    if re.search(r'\b(how many|what.*are the|list|which)\b.*\b(columns?|fields?|variables?)\b', q) or re.search(r'\bschema\b|\bstructure\b', q):
        return {
            'resolved': True, 'intent': 'schema',
            'answer': {'rowCount': int(len(df)), 'columns': [{'name': str(c), 'type': type_map.get(c), 'missingPct': round(float(df[c].isna().mean() * 100), 1)} for c in df.columns]},
        }

    if re.search(r'\b(how many|how much)\b.*\b(rows?|records?|entries?|data points?)\b', q) or q in ('row count', 'number of rows'):
        return {'resolved': True, 'intent': 'row_count', 'answer': {'rowCount': int(len(df)), 'columnCount': int(len(df.columns))}}

    # duplicates
    if re.search(r'\bduplicat', q):
        dup = int(df.duplicated().sum())
        return {'resolved': True, 'intent': 'duplicates', 'answer': {'duplicateRows': dup, 'pct': round(dup / len(df) * 100, 2) if len(df) else 0}}

    # missing
    if re.search(r'\b(missing|null|nan|empty)\b', q):
        col = _find_col(q, list(df.columns))
        if col:
            n = int(df[col].isna().sum())
            return {'resolved': True, 'intent': 'missing', 'answer': {'column': str(col), 'missing': n, 'pct': round(float(df[col].isna().mean() * 100), 2)}}
        total = int(df.isna().sum().sum())
        worst = df.isna().sum().sort_values(ascending=False).head(5)
        return {'resolved': True, 'intent': 'missing', 'answer': {'totalMissingCells': total, 'byColumn': {str(c): int(v) for c, v in worst.items() if v > 0}}}

    # correlation between X and Y
    m = re.search(r'correlation(?:\s+\w+)*\s+between\s+([a-z0-9_\- ]+?)\s+and\s+([a-z0-9_\- ]+)', q)
    if m:
        ca, cb = _find_col(m.group(1), list(df.columns)), _find_col(m.group(2), list(df.columns))
        if ca and cb:
            sa = pd.to_numeric(df[ca], errors='coerce')
            sb = pd.to_numeric(df[cb], errors='coerce')
            mask = sa.notna() & sb.notna()
            if mask.sum() >= 3:
                r = float(sa[mask].corr(sb[mask]))
                return {'resolved': True, 'intent': 'correlation', 'answer': {'columnA': str(ca), 'columnB': str(cb), 'pearson': round(r, 4), 'n': int(mask.sum()), 'interpretation': _corr_word(r)}}
    if re.search(r'\bcorrelat', q) and numeric_cols and len(numeric_cols) >= 2:
        # strongest correlations summary
        corr = df[numeric_cols].apply(pd.to_numeric, errors='coerce').corr()
        pairs = []
        for i, a in enumerate(corr.columns):
            for b in corr.columns[i + 1:]:
                v = corr.loc[a, b]
                if pd.notna(v):
                    pairs.append({'a': str(a), 'b': str(b), 'r': round(float(v), 4)})
        pairs.sort(key=lambda x: -abs(x['r']))
        return {'resolved': True, 'intent': 'correlation_matrix', 'answer': {'topPairs': pairs[:6]}}

    # trend of <col> over time
    if re.search(r'\b(trend|over time|changed?|growth|grew|increase|decrease)\b', q):
        num = _find_col(q, numeric_cols) or (numeric_cols[0] if numeric_cols else None)
        dcol = _find_col(q, date_cols)
        if not dcol and date_cols:
            dcol = date_cols[0]
        if not dcol:
            # look for string columns storing date-like text
            from cleaning.operations import _looks_like_dates
            for c in cat_cols:
                if _looks_like_dates(df[c]):
                    dcol = c
                    break
        if num and dcol:
            work = df[[dcol, num]].copy()
            work[dcol] = pd.to_datetime(work[dcol], errors='coerce')
            work = work.dropna(subset=[dcol])
            work['period'] = work[dcol].dt.strftime('%Y-%m')
            monthly = work.groupby('period')[num].sum() if type_map.get(num) in ('integer', 'float') else work.groupby('period').size()
            monthly = monthly.sort_index()
            if len(monthly) >= 2:
                first, last = float(monthly.iloc[0]), float(monthly.iloc[-1])
                change = round((last - first) / abs(first) * 100, 2) if first != 0 else None
                return {
                    'resolved': True, 'intent': 'trend',
                    'answer': {'column': str(num), 'periodColumn': str(dcol), 'firstPeriod': monthly.index[0], 'lastPeriod': monthly.index[-1], 'firstValue': round(first, 2), 'lastValue': round(last, 2), 'changePct': change, 'nPeriods': int(len(monthly)), 'series': [{'period': str(i), 'value': round(float(v), 2)} for i, v in monthly.tail(24).items()]},
                }

    # distribution of <col>
    m = re.search(r'\b(distribution|breakdown|split|share)\b.*?\b(of|by|for)\s+([a-z0-9_\- ]+)', q)
    if m:
        col = _find_col(m.group(3), list(df.columns))
        if col:
            if type_map.get(col) in ('integer', 'float'):
                s = pd.to_numeric(df[col], errors='coerce').dropna()
                if len(s):
                    return {'resolved': True, 'intent': 'distribution', 'answer': {'column': str(col), 'type': 'numeric', 'min': _r(s.min()), 'max': _r(s.max()), 'mean': _r(s.mean()), 'median': _r(s.median()), 'p25': _r(s.quantile(0.25)), 'p75': _r(s.quantile(0.75))}}
            else:
                vc = df[col].value_counts().head(10)
                total = float(df[col].notna().sum())
                return {'resolved': True, 'intent': 'distribution', 'answer': {'column': str(col), 'type': 'categorical', 'values': [{'value': str(v), 'count': int(c), 'pct': round(c / total * 100, 1)} for v, c in vc.items()]}}

    # top N <col> by <col2>
    m = re.search(r'\btop\s+(\d+)\s+([a-z0-9_\- ]+?)\s+(?:by|based on)\s+([a-z0-9_\- ]+)', q)
    if m:
        n = min(int(m.group(1)), 50)
        by_col = _find_col(m.group(2), list(df.columns))
        val_col = _find_col(m.group(3), numeric_cols) or _find_col(m.group(3), list(df.columns))
        if by_col and val_col and val_col != by_col:
            work = df[[by_col, val_col]].copy()
            work[val_col] = pd.to_numeric(work[val_col], errors='coerce')
            grouped = work.groupby(work[by_col].fillna('Unknown').astype(str))[val_col].sum().sort_values(ascending=False).head(n)
            return {'resolved': True, 'intent': 'top_n', 'answer': {'metric': str(val_col), 'by': str(by_col), 'values': [{'name': str(i), 'value': _r(v)} for i, v in grouped.items()]}}

    # group by <col> [agg of <col2>]
    m = re.search(r'(?:group(?:ed)? by|per|by each)\s+([a-z0-9_\- ]+?)(?:\s+(?:show|with|compute)?\s*(average|mean|total|sum|count|median|max|min)\s+(?:of\s+)?([a-z0-9_\- ]+))?$', q)
    if m:
        by_col = _find_col(m.group(1), list(df.columns))
        agg_word = m.group(2)
        val_col = _find_col(m.group(3), list(df.columns)) if m.group(3) else None
        if by_col:
            agg = {'average': 'mean', 'mean': 'mean', 'total': 'sum', 'sum': 'sum', 'median': 'median', 'max': 'max', 'min': 'min', 'count': 'count'}.get(agg_word or 'count', 'count')
            work = df.copy()
            if val_col and agg != 'count':
                work[val_col] = pd.to_numeric(work[val_col], errors='coerce')
                grouped = work.groupby(work[by_col].fillna('Unknown').astype(str))[val_col].agg(agg).sort_values(ascending=False).head(10)
            else:
                grouped = work.groupby(work[by_col].fillna('Unknown').astype(str)).size().sort_values(ascending=False).head(10)
            return {'resolved': True, 'intent': 'group_by', 'answer': {'by': str(by_col), 'metric': str(val_col) if val_col and agg != 'count' else 'row count', 'aggregate': agg, 'values': [{'name': str(i), 'value': _r(v)} for i, v in grouped.items()]}}

    # superlative: which <col> has the highest/lowest <metric>
    m = re.search(r'(?:which|what)\s+([a-z0-9_\- ]+?)\s+(?:has|have|had)\s+the\s+(highest|largest|most|maximum|lowest|smallest|least|minimum)\s+([a-z0-9_\- ]+)', q)
    if m:
        by_col = _find_col(m.group(1), list(df.columns))
        val_col = _find_col(m.group(3), numeric_cols) or _find_col(m.group(3), list(df.columns))
        direction = m.group(2)
        if by_col and val_col and val_col != by_col:
            work = df[[by_col, val_col]].copy()
            work[val_col] = pd.to_numeric(work[val_col], errors='coerce')
            grouped = work.groupby(work[by_col].fillna('Unknown').astype(str))[val_col].sum().sort_values(ascending=(direction in ('lowest', 'smallest', 'least', 'minimum')))
            top = grouped.iloc[0] if len(grouped) else None
            top_name = grouped.index[0] if len(grouped) else None
            return {
                'resolved': True, 'intent': 'superlative',
                'answer': {'by': str(by_col), 'metric': str(val_col), 'direction': direction, 'topName': str(top_name), 'topValue': _r(top),
                           'ranking': [{'name': str(i), 'value': _r(v)} for i, v in grouped.head(10).items()]},
            }

    # aggregate of <col>: average/total/sum/max/min/count
    m = re.search(r'\b(average|mean|median|total|sum|max(?:imum)?|min(?:imum)?|count|number of)\b(?:\s+(?:value|values|of|for|in))?\s+([a-z0-9_\- ]+)', q)
    if m:
        word = m.group(1)
        col = _find_col(m.group(2), list(df.columns))
        if col:
            if word in ('count', 'number of'):
                return {'resolved': True, 'intent': 'aggregate', 'answer': {'column': str(col), 'aggregate': 'count', 'value': int(df[col].notna().sum())}}
            s = pd.to_numeric(df[col], errors='coerce').dropna()
            if len(s) == 0:
                return {'resolved': True, 'intent': 'aggregate', 'answer': {'column': str(col), 'aggregate': word, 'value': None, 'note': 'No numeric values in this column'}}
            agg = {'average': 'mean', 'mean': 'mean', 'median': 'median', 'total': 'sum', 'sum': 'sum', 'max': 'max', 'maximum': 'max', 'min': 'min', 'minimum': 'min'}.get(word, 'mean')
            value = _r(getattr(s, 'median' if agg == 'median' else agg)() if agg != 'sum' else s.sum())
            return {'resolved': True, 'intent': 'aggregate', 'answer': {'column': str(col), 'aggregate': agg, 'value': value, 'n': int(len(s))}}

    return {'resolved': False}


def _find_col(text, candidates):
    text = text.lower().strip()
    best = None
    for c in candidates:
        cname = str(c).lower().strip()
        if cname and re.search(r'(?<![a-z0-9_])' + re.escape(cname) + r'(?![a-z0-9_])', text):
            return c
    for c in candidates:
        cname = str(c).lower().strip()
        if len(cname) >= 3 and cname in text:
            if best is None or len(cname) > len(str(best).lower()):
                best = c
    return best


def _corr_word(r):
    a = abs(r)
    w = 'strong' if a >= 0.7 else ('moderate' if a >= 0.4 else ('weak' if a >= 0.2 else 'very weak'))
    return f'{w} {"positive" if r > 0 else "negative"} association'


def _r(v):
    try:
        f = float(v)
        if not np.isfinite(f):
            return None
        return round(f, 4)
    except (TypeError, ValueError):
        return None
