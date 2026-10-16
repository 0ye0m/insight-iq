import pandas as pd
import chardet
import os


DEFAULT_MISSING_VALUES = [
    'null', 'NULL', 'None', 'none', 'NaN', 'nan', 'NAN',
    'NA', 'na', 'N/A', 'n/a', 'n.a.', '-', '--',
    'empty', 'EMPTY', '', ' ', '  ',
    '?', '???', 'unknown', 'Unknown', 'UNKNOWN',
    'missing', 'Missing', 'MISSING', 'nul', 'NUL',
    '#N/A', '#REF!', '#DIV/0!', '#VALUE!', '#NAME?',
    '#NULL!', '#NUM!', r'\-', '',
]


def detect_encoding(file_path):
    """Detect file encoding using chardet."""
    try:
        with open(file_path, 'rb') as f:
            raw = f.read(65536)
        result = chardet.detect(raw)
        encoding = result.get('encoding', 'utf-8')
        if encoding:
            return encoding.lower().replace('-', '_')
        return 'utf_8'
    except Exception:
        return 'utf_8'


def detect_delimiter(file_path, encoding='utf_8'):
    """Detect the delimiter in a text file."""
    try:
        with open(file_path, 'r', encoding=encoding) as f:
            lines = []
            for i, line in enumerate(f):
                if i >= 20:
                    break
                lines.append(line.rstrip('\n\r'))

        if not lines:
            return ','

        # Try common delimiters and pick the one with most consistent column count
        best_delim = ','
        best_score = -1

        for delim in [',', '\t', ';', '|']:
            counts = [len(line.split(delim)) for line in lines if line.strip()]
            if not counts:
                continue
            # Consistency: all lines should have the same number of columns
            # Score: number of lines with the most common count
            from collections import Counter
            count_freq = Counter(counts)
            most_common_count, freq = count_freq.most_common(1)[0]
            score = freq * most_common_count  # More columns and more consistent lines = better
            if score > best_score and most_common_count > 1:
                best_score = score
                best_delim = delim

        return best_delim
    except Exception:
        return ','


def load_csv_tsv_txt(file_path, cfg):
    """
    Load CSV, TSV, or TXT files using Pandas.
    Returns (DataFrame, info_dict) or (None, error_info).
    """
    ext = os.path.splitext(file_path)[1].lower()

    # Determine encoding
    encoding = detect_encoding(file_path)

    # Handle UTF-8 BOM
    if encoding in ('utf_8_sig', 'utf_8'):
        try:
            with open(file_path, 'rb') as f:
                bom = f.read(3)
            if bom == b'\xef\xbb\xbf':
                encoding = 'utf_8_sig'
        except Exception:
            pass

    # Determine delimiter
    if ext == '.tsv':
        delimiter = '\t'
    elif ext == '.csv':
        delimiter = ','
    else:  # .txt - auto-detect
        delimiter = detect_delimiter(file_path, encoding)

    try:
        df = pd.read_csv(
            file_path,
            sep=delimiter,
            encoding=encoding,
            na_values=DEFAULT_MISSING_VALUES,
            keep_default_na=True,
            on_bad_lines='warn',
            dtype_backend='numpy_nullable',
            low_memory=False,
        )
    except TypeError:
        # Older pandas without dtype_backend
        df = pd.read_csv(
            file_path,
            sep=delimiter,
            encoding=encoding,
            na_values=DEFAULT_MISSING_VALUES,
            keep_default_na=True,
            on_bad_lines='warn',
            low_memory=False,
        )

    # Validate
    if df.empty:
        raise ValueError('The file contains no data rows after parsing.')

    if len(df.columns) > cfg['max_columns']:
        raise ValueError(f'Dataset has {len(df.columns)} columns, exceeding limit of {cfg["max_columns"]}.')

    if len(df) > cfg['max_rows']:
        df = df.head(cfg['max_rows'])

    info = {
        'rows': len(df),
        'columns': len(df.columns),
        'columnsList': list(df.columns),
        'delimiter': delimiter,
        'encoding': encoding,
        'sizeBytes': os.path.getsize(file_path),
    }

    return df, info
