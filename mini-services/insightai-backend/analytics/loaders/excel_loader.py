import pandas as pd
import os


def load_excel(file_path, cfg):
    """
    Load Excel files (.xlsx, .xls, .ods) into a DataFrame.
    Returns (DataFrame, info_dict).
    """
    ext = os.path.splitext(file_path)[1].lower()

    if ext == '.xls':
        engine = 'xlrd'
    elif ext == '.ods':
        engine = 'odf'
    else:
        engine = 'openpyxl'

    # First, get sheet metadata
    xl = pd.ExcelFile(file_path, engine=engine)
    sheets_meta = []
    for sheet_name in xl.sheet_names:
        try:
            df_sheet = pd.read_excel(xl, sheet_name=sheet_name, nrows=5)
            sheets_meta.append({
                'name': sheet_name,
                'columns': len(df_sheet.columns) if df_sheet is not None and not df_sheet.empty else 0,
                'previewRows': 5,
            })
        except Exception:
            sheets_meta.append({
                'name': sheet_name,
                'columns': 0,
                'error': 'Could not read sheet preview',
            })

    # Read the first non-empty sheet
    df = None
    selected_sheet = None
    for sheet_name in xl.sheet_names:
        try:
            df_candidate = pd.read_excel(
                xl,
                sheet_name=sheet_name,
                engine=engine,
            )
            if df_candidate is not None and not df_candidate.empty:
                df = df_candidate
                selected_sheet = sheet_name
                break
        except Exception:
            continue

    if df is None or df.empty:
        raise ValueError('No usable data found in any Excel sheet.')

    if len(df.columns) > cfg['max_columns']:
        raise ValueError(f'Dataset has {len(df.columns)} columns, exceeding limit.')

    if len(df) > cfg['max_rows']:
        df = df.head(cfg['max_rows'])

    # Get full row counts for all sheets
    for sm in sheets_meta:
        if sm['name'] == selected_sheet:
            sm['rows'] = len(df)
            sm['columns'] = len(df.columns)

    info = {
        'rows': len(df),
        'columns': len(df.columns),
        'columnsList': list(df.columns),
        'selectedSheet': selected_sheet,
        'availableSheets': sheets_meta,
        'engine': engine,
        'sizeBytes': os.path.getsize(file_path),
    }

    return df, info
