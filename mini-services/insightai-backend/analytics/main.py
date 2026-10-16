#!/usr/bin/env python3
"""
InsightIQ Analytics Engine — Main Entry Point (extended from original InsightAI).

Receives JSON commands via stdin, executes the requested deterministic operation,
and writes JSON results to stdout. Never exposed as an HTTP service; only invoked
by the Node.js backend via controlled subprocess.

Versioned dataset store:
  data/processed/{fileId}/meta.json   — versions, currentVersion, hashes
  data/processed/{fileId}/v{n}.pkl    — pickled DataFrame snapshot (preserves dtypes)
  data/processed/{fileId}/doc.json    — parsed document
  data/processed/{fileId}/chunks.json — RAG chunks
"""

import sys
import json
import os
import hashlib
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from loaders.csv_loader import load_csv_tsv_txt
from loaders.json_loader import load_json
from loaders.excel_loader import load_excel
from loaders.parquet_loader import load_parquet
from documents.pdf_parser import parse_pdf
from documents.docx_parser import parse_docx
from documents.pptx_parser import parse_pptx
from documents.odt_parser import parse_odt
from documents.rtf_parser import parse_rtf
from documents.html_parser import parse_html
from documents.xml_parser import parse_xml
from documents.markdown_parser import parse_markdown
from cleaning.type_detection import detect_column_types
from cleaning.operations import propose_operations, apply_operations
from analysis.profiler import profile_columns
from analysis.statistics import compute_statistics
from analysis.correlation import compute_correlations
from analysis.quality import compute_quality
from analysis.plan_executor import execute_plan
from analysis.comparison import compare_datasets
from analysis.query import answer_query
from rag.chunker import chunk_document
from rag.retriever import retrieve_chunks

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROCESSED_DIR = os.environ.get('PROCESSED_DIR') or os.path.join(os.path.dirname(BASE_DIR), 'data', 'processed')


def get_config():
    return {
        'max_rows': int(os.environ.get('MAX_ROWS', '100000')),
        'max_columns': int(os.environ.get('MAX_COLUMNS', '500')),
        'max_pages': int(os.environ.get('MAX_PAGES', '200')),
        'max_extracted_text_chars': int(os.environ.get('MAX_EXTRACTED_TEXT_CHARS', '500000')),
        'chunk_size': int(os.environ.get('CHUNK_SIZE', '1000')),
        'chunk_overlap': int(os.environ.get('CHUNK_OVERLAP', '200')),
        'max_chunks': int(os.environ.get('MAX_CHUNKS', '500')),
        'rag_top_k': int(os.environ.get('RAG_TOP_K', '5')),
    }


# ─── Dataset store helpers ─────────────────────────────────────────────

def dataset_dir(file_id):
    safe = ''.join(c for c in str(file_id) if c.isalnum() or c in '-_')
    return os.path.join(PROCESSED_DIR, safe)


def meta_path(file_id):
    return os.path.join(dataset_dir(file_id), 'meta.json')


def version_path(file_id, version):
    return os.path.join(dataset_dir(file_id), f'v{version}.pkl')


def load_meta(file_id):
    p = meta_path(file_id)
    if not os.path.exists(p):
        raise ValueError(f'Dataset {file_id} not found')
    with open(p, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_meta(file_id, meta):
    os.makedirs(dataset_dir(file_id), exist_ok=True)
    with open(meta_path(file_id), 'w', encoding='utf-8') as f:
        json.dump(meta, f)


def load_version_df(file_id, version=None):
    meta = load_meta(file_id)
    v = version if version is not None else meta.get('currentVersion', 1)
    v = int(v)
    if not any(int(x['version']) == v for x in meta.get('versions', [])):
        raise ValueError(f'Version {v} not found for dataset {file_id}')
    import pandas as pd
    return pd.read_pickle(version_path(file_id, v)), meta, v


def save_version_df(file_id, df, ops_applied):
    meta = load_meta(file_id)
    version = len(meta.get('versions', [])) + 1
    os.makedirs(dataset_dir(file_id), exist_ok=True)
    df.to_pickle(version_path(file_id, version))
    meta['versions'].append({
        'version': version,
        'opsApplied': ops_applied,
        'rows': int(len(df)),
        'cols': int(len(df.columns)),
        'hash': dataset_hash(df),
        'createdAt': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
    })
    meta['currentVersion'] = version
    save_meta(file_id, meta)
    return version, meta


def dataset_hash(df):
    try:
        sample = df.head(50).to_csv(index=False) + df.tail(10).to_csv(index=False) + str(df.shape)
        return hashlib.sha256(sample.encode('utf-8', 'ignore')).hexdigest()[:16]
    except Exception:
        return hashlib.sha256(str(df.shape).encode()).hexdigest()[:16]


# ─── Parsing ───────────────────────────────────────────────────────────

def _parse_tabular(file_path, fmt, cfg):
    try:
        if fmt in ('.csv', '.tsv', '.txt'):
            return load_csv_tsv_txt(file_path, cfg)
        elif fmt in ('.json', '.jsonl', '.ndjson'):
            return load_json(file_path, cfg)
        elif fmt in ('.xlsx', '.xls', '.ods'):
            return load_excel(file_path, cfg)
        elif fmt == '.parquet':
            return load_parquet(file_path, cfg)
    except Exception:
        return None, {'error': traceback.format_exc(limit=2)}
    return None, {'error': 'No tabular parser for format'}


def _parse_document(file_path, fmt, cfg):
    try:
        if fmt == '.pdf':
            return parse_pdf(file_path, cfg)
        elif fmt == '.docx':
            return parse_docx(file_path, cfg)
        elif fmt == '.pptx':
            return parse_pptx(file_path, cfg)
        elif fmt == '.odt':
            return parse_odt(file_path, cfg)
        elif fmt in ('.rtf',):
            return parse_rtf(file_path, cfg)
        elif fmt in ('.html', '.htm'):
            return parse_html(file_path, cfg)
        elif fmt == '.xml':
            return parse_xml(file_path, cfg)
        elif fmt in ('.md', '.markdown'):
            return parse_markdown(file_path, cfg)
    except Exception as e:
        return {'error': str(e)}
    return None


def _build_schema(df):
    schema = {}
    for col in df.columns:
        schema[col] = {
            'dtype': str(df[col].dtype),
            'nullable': bool(df[col].isna().any()),
            'uniqueCount': int(df[col].nunique()),
            'sampleValues': [str(v) for v in df[col].dropna().head(5).tolist()],
        }
    return schema


def handle_snapshot(cmd, cfg):
    """Parse an uploaded file, persist v1 snapshot, return basic info + digest."""
    file_path = cmd['filePath']
    fmt = cmd['format']
    file_id = cmd['fileId']
    category = cmd.get('category', 'UNKNOWN')

    df, parse_info = _parse_tabular(file_path, fmt, cfg)
    if df is not None and len(df) > 0:
        os.makedirs(dataset_dir(file_id), exist_ok=True)
        df.to_pickle(version_path(file_id, 1))
        meta = {
            'fileId': file_id,
            'fileName': cmd.get('fileName', ''),
            'fileType': 'TABULAR',
            'format': fmt,
            'versions': [{
                'version': 1, 'opsApplied': [], 'rows': int(len(df)), 'cols': int(len(df.columns)),
                'hash': dataset_hash(df),
                'createdAt': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
            }],
            'currentVersion': 1,
        }
        save_meta(file_id, meta)
        profile = build_profile(df, cfg)
        return {
            'fileType': 'TABULAR',
            'fileId': file_id,
            'format': fmt,
            'parseInfo': parse_info,
            'rowCount': int(len(df)),
            'colCount': int(len(df.columns)),
            'columns': list(map(str, df.columns)),
            'schema': _build_schema(df),
            'profile': profile,
            'versionHash': meta['versions'][0]['hash'],
        }

    doc = _parse_document(file_path, fmt, cfg)
    if doc and not doc.get('error'):
        full_text = doc.get('fullText', '')
        if not full_text and doc.get('sections'):
            full_text = '\n\n'.join(s.get('text', '') for s in doc['sections'])
        doc['fullText'] = (full_text or '')[:cfg['max_extracted_text_chars']]
        os.makedirs(dataset_dir(file_id), exist_ok=True)
        with open(os.path.join(dataset_dir(file_id), 'doc.json'), 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False)
        chunks = chunk_document(doc, cfg)
        with open(os.path.join(dataset_dir(file_id), 'chunks.json'), 'w', encoding='utf-8') as f:
            json.dump(chunks, f, ensure_ascii=False)
        return {
            'fileType': 'DOCUMENT',
            'fileId': file_id,
            'format': fmt,
            'documentType': doc.get('documentType', 'unknown'),
            'totalPages': doc.get('totalPages', 0),
            'textLength': len(doc.get('fullText', '')),
            'wordCount': len(doc.get('fullText', '').split()),
            'chunkCount': len(chunks),
            'metadata': doc.get('metadata', {}),
            'sectionsPreview': [
                {'title': s.get('title', ''), 'preview': s.get('text', '')[:300]}
                for s in (doc.get('sections') or [])[:6]
            ],
        }

    raise ValueError(f'Cannot parse file format "{fmt}" as tabular or document: {parse_info}')


def handle_parse_document_only(cmd, cfg):
    """Re-parse a document file (used after URL text ingestion)."""
    return handle_snapshot(cmd, cfg)


# ─── Profiling (Layer 1) ───────────────────────────────────────────────

def build_profile(df, cfg):
    type_map = detect_column_types(df)
    column_profiles = profile_columns(df, type_map, cfg)
    statistics = compute_statistics(df, type_map, cfg)
    correlations = compute_correlations(df, type_map)
    quality = compute_quality(df, type_map, statistics)
    samples = []
    try:
        head = df.head(5).copy()
        for col in head.columns:
            if str(head[col].dtype).startswith('datetime'):
                head[col] = head[col].dt.strftime('%Y-%m-%d %H:%M:%S')
        samples = [list(map(str, row)) for row in head.itertuples(index=False, name=None)]
    except Exception:
        samples = []
    time_range = None
    date_cols = [c for c, t in type_map.items() if t == 'datetime']
    if date_cols:
        c = date_cols[0]
        try:
            dt = __import__('pandas').to_datetime(df[c], errors='coerce').dropna()
            if len(dt) > 0:
                time_range = {'column': c, 'min': str(dt.min()), 'max': str(dt.max()), 'distinctDays': int((dt.max() - dt.min()).days)}
        except Exception:
            pass
    return {
        'rowCount': int(len(df)),
        'colCount': int(len(df.columns)),
        'columns': column_profiles,
        'typeMap': type_map,
        'statistics': statistics,
        'correlations': correlations,
        'quality': quality,
        'timeRange': time_range,
        'samples': samples,
    }


def handle_profile(cmd, cfg):
    df, meta, v = load_version_df(cmd['fileId'], cmd.get('version'))
    profile = build_profile(df, cfg)
    profile['version'] = v
    profile['versionHash'] = meta['versions'][v - 1]['hash']
    return profile


# ─── Plan execution (Layer 4) ──────────────────────────────────────────

def handle_execute_plan(cmd, cfg):
    df, meta, v = load_version_df(cmd['fileId'], cmd.get('version'))
    plan = cmd.get('plan') or {}
    results = execute_plan(df, plan, cfg)
    results['version'] = v
    return results


# ─── Cleaning ──────────────────────────────────────────────────────────

def handle_clean_preview(cmd, cfg):
    df, meta, v = load_version_df(cmd['fileId'], cmd.get('version'))
    type_map = detect_column_types(df)
    stats = compute_statistics(df, type_map, cfg)
    operations = propose_operations(df, type_map, stats, cfg)
    return {'version': v, 'operations': operations}


def handle_clean_apply(cmd, cfg):
    df, meta, v = load_version_df(cmd['fileId'], None)
    selected = cmd.get('operations') or []
    if not selected:
        raise ValueError('No cleaning operations selected')
    df_before = df.copy()
    applied, details = apply_operations(df, selected, cfg)
    # persist new version
    version, meta2 = save_version_df(cmd['fileId'], df, applied)
    type_map_before = detect_column_types(df_before)
    stats_before = compute_statistics(df_before, type_map_before, cfg)
    quality_before = compute_quality(df_before, type_map_before, stats_before)
    type_map_after = detect_column_types(df)
    stats_after = compute_statistics(df, type_map_after, cfg)
    quality_after = compute_quality(df, type_map_after, stats_after)
    return {
        'appliedVersion': version,
        'parentVersion': v,
        'operationsApplied': applied,
        'details': details,
        'before': quality_before,
        'after': quality_after,
        'rowCountBefore': int(len(df_before)),
        'rowCountAfter': int(len(df)),
    }


def handle_clean_reset(cmd, cfg):
    meta = load_meta(cmd['fileId'])
    if len(meta.get('versions', [])) < 2:
        return {'reset': False, 'reason': 'No cleaned version to reset'}
    meta['currentVersion'] = 1
    save_meta(cmd['fileId'], meta)
    return {'reset': True, 'currentVersion': 1}


def handle_versions(cmd, cfg):
    meta = load_meta(cmd['fileId'])
    return {'versions': meta.get('versions', []), 'currentVersion': meta.get('currentVersion')}


# ─── Quality ───────────────────────────────────────────────────────────

def handle_quality(cmd, cfg):
    df, meta, v = load_version_df(cmd['fileId'], cmd.get('version'))
    type_map = detect_column_types(df)
    stats = compute_statistics(df, type_map, cfg)
    return compute_quality(df, type_map, stats)


# ─── Compare ───────────────────────────────────────────────────────────

def handle_compare(cmd, cfg):
    df_a, meta_a, v_a = load_version_df(cmd['fileIdA'], cmd.get('versionA'))
    df_b, meta_b, v_b = load_version_df(cmd['fileIdB'], cmd.get('versionB'))
    label_a = cmd.get('labelA') or f'{cmd["fileIdA"]}#v{v_a}'
    label_b = cmd.get('labelB') or f'{cmd["fileIdB"]}#v{v_b}'
    result = compare_datasets(df_a, df_b, f'{label_a} · v{v_a}', f'{label_b} · v{v_b}', cfg)
    result['a'] = {'fileId': cmd['fileIdA'], 'version': v_a}
    result['b'] = {'fileId': cmd['fileIdB'], 'version': v_b}
    return result


# ─── Grounded query (chat backend) ─────────────────────────────────────

def handle_query(cmd, cfg):
    df, meta, v = load_version_df(cmd['fileId'], cmd.get('version'))
    question = cmd.get('question', '')
    type_map = detect_column_types(df)
    stats = compute_statistics(df, type_map, cfg)
    return answer_query(df, question, type_map, stats, cfg)


def handle_sample_rows(cmd, cfg):
    df, meta, v = load_version_df(cmd['fileId'], cmd.get('version'))
    n = int(cmd.get('n', 20))
    offset = int(cmd.get('offset', 0))
    slice_df = df.iloc[offset:offset + n]
    cols = list(map(str, df.columns))
    rows = []
    for row in slice_df.itertuples(index=False, name=None):
        vals = []
        for val in row:
            try:
                if val is None or (isinstance(val, float) and val != val):
                    vals.append(None)
                else:
                    vals.append(str(val))
            except Exception:
                vals.append(str(val))
        rows.append(vals)
    return {'columns': cols, 'rows': rows, 'total': int(len(df)), 'offset': offset}


def handle_export_csv(cmd, cfg):
    df, meta, v = load_version_df(cmd['fileId'], cmd.get('version'))
    import io
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    return {'csv': buf.getvalue(), 'version': v, 'rows': int(len(df))}


def handle_retrieve(cmd, cfg):
    file_id = cmd['fileId']
    chunks_file = os.path.join(dataset_dir(file_id), 'chunks.json')
    if not os.path.exists(chunks_file):
        return {'retrievedChunks': []}
    with open(chunks_file, 'r', encoding='utf-8') as f:
        chunks = json.load(f)
    top_k = int(cmd.get('topK', cfg['rag_top_k']))
    return {'retrievedChunks': retrieve_chunks(cmd.get('question', ''), chunks, top_k)}


def handle_document_info(cmd, cfg):
    file_id = cmd['fileId']
    doc_file = os.path.join(dataset_dir(file_id), 'doc.json')
    chunks_file = os.path.join(dataset_dir(file_id), 'chunks.json')
    doc = None
    chunks_n = 0
    if os.path.exists(doc_file):
        with open(doc_file, 'r', encoding='utf-8') as f:
            doc = json.load(f)
    if os.path.exists(chunks_file):
        with open(chunks_file, 'r', encoding='utf-8') as f:
            chunks_n = len(json.load(f))
    return {'document': doc, 'chunkCount': chunks_n}


# ─── Fallback planner (deterministic, no AI) ───────────────────────────

def handle_fallback_plan(cmd, cfg):
    """Deterministic plan built from the profile — used when AI is unavailable."""
    df, meta, v = load_version_df(cmd['fileId'], cmd.get('version'))
    type_map = detect_column_types(df)
    stats = compute_statistics(df, type_map, cfg)
    plan = {'objectives': ['Overview of key measures', 'Category comparisons', 'Distributions'], 'datasetSummary': '', 'kpis': [], 'charts': [], 'tests': [], 'cleaningFocus': [], 'notes': 'Deterministic fallback plan (AI planner unavailable).'}
    numeric_cols = [c for c, t in type_map.items() if t in ('integer', 'float')]
    cat_cols = [c for c, t in type_map.items() if t in ('categorical', 'boolean') or (t == 'string' and stats.get(c, {}).get('uniqueCount', 999) <= 12)]
    date_cols = [c for c, t in type_map.items() if t == 'datetime']

    for col in numeric_cols[:3]:
        plan['kpis'].append({'id': f'k_sum_{col}', 'label': f'Total {col}', 'kind': 'aggregate', 'column': col, 'aggregate': 'sum', 'unit': 'number', 'description': f'Sum of {col}', 'priority': 1})
        plan['kpis'].append({'id': f'k_avg_{col}', 'label': f'Average {col}', 'kind': 'aggregate', 'column': col, 'aggregate': 'mean', 'unit': 'number', 'description': f'Mean of {col}', 'priority': 2})
    for col in cat_cols[:2]:
        plan['kpis'].append({'id': f'k_cnt_{col}', 'label': f'Records per {col} (top)', 'kind': 'grouped', 'group': {'by': col, 'column': col, 'aggregate': 'count', 'limit': 5}, 'unit': 'count', 'description': f'Row counts by {col}', 'priority': 3})

    if date_cols and numeric_cols:
        plan['charts'].append({'id': 'c_trend', 'type': 'line', 'title': f'{numeric_cols[0]} over {date_cols[0]}', 'reason': 'Temporal trend of the primary numeric column', 'x': {'column': date_cols[0], 'bin': 'month'}, 'y': {'column': numeric_cols[0], 'aggregate': 'sum'}, 'series': None, 'limit': 24, 'priority': 1})
    if cat_cols and numeric_cols:
        plan['charts'].append({'id': 'c_bar', 'type': 'bar', 'title': f'{numeric_cols[0]} by {cat_cols[0]}', 'reason': 'Category comparison', 'x': {'column': cat_cols[0], 'bin': 'none'}, 'y': {'column': numeric_cols[0], 'aggregate': 'sum'}, 'series': None, 'limit': 12, 'priority': 2})
    if numeric_cols:
        plan['charts'].append({'id': 'c_hist', 'type': 'histogram', 'title': f'Distribution of {numeric_cols[0]}', 'reason': 'Numeric distribution', 'x': {'column': numeric_cols[0], 'bin': 'none'}, 'y': {'column': None, 'aggregate': 'count'}, 'series': None, 'limit': 0, 'priority': 3})
    if cat_cols:
        plan['charts'].append({'id': 'c_pie', 'type': 'donut', 'title': f'Share by {cat_cols[0]}', 'reason': 'Composition of the main categorical column', 'x': {'column': cat_cols[0], 'bin': 'none'}, 'y': {'column': None, 'aggregate': 'count'}, 'series': None, 'limit': 8, 'priority': 4})
    if len(numeric_cols) >= 2:
        plan['tests'].append({'id': 't_corr', 'type': 'correlation', 'columns': numeric_cols[:2], 'description': 'Association between the two primary numeric columns'})
    return {'plan': plan, 'version': v}


def handle_ping(cmd, cfg):
    return {'pong': True}


COMMANDS = {
    'ping': handle_ping,
    'snapshot': handle_snapshot,
    'parse_document': handle_parse_document_only,
    'profile': handle_profile,
    'execute_plan': handle_execute_plan,
    'clean_preview': handle_clean_preview,
    'clean_apply': handle_clean_apply,
    'clean_reset': handle_clean_reset,
    'versions': handle_versions,
    'quality': handle_quality,
    'compare': handle_compare,
    'query': handle_query,
    'sample_rows': handle_sample_rows,
    'export_csv': handle_export_csv,
    'retrieve': handle_retrieve,
    'document_info': handle_document_info,
    'fallback_plan': handle_fallback_plan,
}


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            json.dump({'error': 'No input provided'}, sys.stdout)
            sys.stdout.flush()
            return
        data = json.loads(raw)
        command = data.get('command', '')
        if command not in COMMANDS:
            json.dump({'error': f'Unknown command: {command}'}, sys.stdout)
            sys.stdout.flush()
            return
        cfg = get_config()
        result = COMMANDS[command](data, cfg)
        json.dump({'success': True, 'data': result}, sys.stdout, ensure_ascii=False, default=str)
        sys.stdout.flush()
    except SystemExit:
        raise
    except Exception as e:
        sys.stderr.write(traceback.format_exc())
        sys.stderr.flush()
        json.dump({'error': str(e)}, sys.stdout)
        sys.stdout.flush()


if __name__ == '__main__':
    main()
