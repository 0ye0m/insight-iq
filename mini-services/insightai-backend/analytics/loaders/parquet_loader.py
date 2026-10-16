import pandas as pd
import os


def load_parquet(file_path, cfg):
    """
    Load Parquet files into a DataFrame.
    Returns (DataFrame, info_dict).
    """
    # Validate the file exists and has content
    file_size = os.path.getsize(file_path)
    if file_size == 0:
        raise ValueError('The Parquet file is empty.')

    df = pd.read_parquet(file_path)

    if df.empty:
        raise ValueError('The Parquet file contains no rows.')

    if len(df.columns) > cfg['max_columns']:
        raise ValueError(f'Dataset has {len(df.columns)} columns, exceeding limit.')

    if len(df) > cfg['max_rows']:
        df = df.head(cfg['max_rows'])

    info = {
        'rows': len(df),
        'columns': len(df.columns),
        'columnsList': list(df.columns),
        'dtypes': {col: str(dtype) for col, dtype in df.dtypes.items()},
        'sizeBytes': file_size,
    }

    return df, info
