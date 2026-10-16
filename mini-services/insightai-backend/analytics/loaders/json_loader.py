import pandas as pd
import json
import os


def _flatten_dict(d, parent_key='', sep='.', max_depth=5, current_depth=0):
    """Recursively flatten a nested dictionary with depth limit."""
    items = []
    for k, v in d.items():
        new_key = f"{parent_key}{sep}{k}" if parent_key else str(k)
        if isinstance(v, dict) and current_depth < max_depth:
            items.extend(_flatten_dict(v, new_key, sep, max_depth, current_depth + 1).items())
        elif isinstance(v, list) and current_depth < max_depth:
            # If list of dicts, flatten
            if v and isinstance(v[0], dict):
                for i, item in enumerate(v[:10]):  # Limit expansion
                    items.extend(_flatten_dict(item, f"{new_key}[{i}]", sep, max_depth, current_depth + 1).items())
            else:
                items.append((new_key, json.dumps(v)))
        else:
            items.append((new_key, v))
    return dict(items)


def load_json(file_path, cfg):
    """
    Load JSON or JSONL files into a DataFrame.
    Returns (DataFrame, info_dict).
    """
    ext = os.path.splitext(file_path)[1].lower()

    with open(file_path, 'r', encoding='utf-8') as f:
        raw = f.read()

    if not raw.strip():
        raise ValueError('The JSON file is empty.')

    # JSONL / NDJSON
    if ext in ('.jsonl', '.ndjson'):
        records = []
        for line in raw.strip().split('\n'):
            line = line.strip()
            if line:
                records.append(json.loads(line))
        df = pd.json_normalize(records, max_level=3, sep='.')
    else:
        # Regular JSON
        data = json.loads(raw)

        if isinstance(data, list):
            # Array of records
            df = pd.json_normalize(data, max_level=3, sep='.')
        elif isinstance(data, dict):
            # Check if it's a list of records under a key
            found_list = False
            for key, val in data.items():
                if isinstance(val, list) and val and isinstance(val[0], dict):
                    df = pd.json_normalize(val, max_level=3, sep='.')
                    found_list = True
                    break
            if not found_list:
                # Flatten the single object into a row
                flat = _flatten_dict(data)
                df = pd.DataFrame([flat])
        else:
            raise ValueError('JSON must be an object or array of objects.')

    if df.empty:
        raise ValueError('The JSON file contains no usable tabular data.')

    if len(df.columns) > cfg['max_columns']:
        raise ValueError(f'Dataset has {len(df.columns)} columns, exceeding limit.')

    if len(df) > cfg['max_rows']:
        df = df.head(cfg['max_rows'])

    info = {
        'rows': len(df),
        'columns': len(df.columns),
        'columnsList': list(df.columns),
        'format': 'json',
        'sizeBytes': os.path.getsize(file_path),
    }

    return df, info
