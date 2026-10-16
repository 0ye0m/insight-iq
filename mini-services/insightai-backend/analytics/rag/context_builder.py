def build_tabular_context(question, question_type, analysis, retrieved_chunks, cfg):
    """
    Build LLM context for tabular data questions.
    For numerical questions, include deterministic calculations.
    """
    context_parts = []

    # Always include schema
    schema = analysis.get('schema', {})
    if schema:
        schema_text = 'Columns: ' + ', '.join(schema.keys())
        type_info = []
        for col, info in schema.items():
            type_info.append(f"  - {col}: {info.get('dtype', 'unknown')}")
        context_parts.append('Dataset Schema:\n' + '\n'.join(type_info))

    # Include statistics for STATISTICS questions
    if question_type in ('STATISTICS', 'AGGREGATION', 'CORRELATION', 'TREND'):
        stats = analysis.get('statistics', {})
        type_map = analysis.get('typeMap', {})

        # Find relevant columns mentioned in the question
        q_lower = question.lower()
        relevant_cols = [c for c in analysis.get('columns', []) if c.lower() in q_lower]
        if not relevant_cols:
            relevant_cols = [c for c, t in type_map.items() if t in ('integer', 'float')][:5]

        for col in relevant_cols:
            if col in stats:
                col_stats = stats[col]
                if 'error' not in col_stats:
                    context_parts.append(f'Statistics for "{col}": ' + _format_stats(col_stats))

    # Include KPIs
    kpis = analysis.get('kpis', [])
    if kpis:
        kpi_text = 'Key Metrics:\n'
        for kpi in kpis[:15]:
            val = kpi.get('value', '')
            label = kpi.get('label', '')
            subtitle = kpi.get('subtitle', '')
            kpi_text += f'  - {label}: {val}'
            if subtitle:
                kpi_text += f' ({subtitle})'
            kpi_text += '\n'
        context_parts.append(kpi_text)

    # Include correlations for CORRELATION questions
    if question_type == 'CORRELATION':
        corrs = analysis.get('correlations', [])
        if corrs:
            corr_text = 'Correlations:\n'
            for c in corrs[:10]:
                corr_text += f"  - {c['columnA']} & {c['columnB']}: {c['correlation']} ({c['strength']} {c['direction']})\n"
            context_parts.append(corr_text)

    # Include visualizations hint
    viz = analysis.get('visualizations', [])
    if viz:
        viz_text = 'Available Visualizations:\n'
        for v in viz[:5]:
            viz_text += f"  - {v['type']}: {v['title']}\n"
        context_parts.append(viz_text)

    # Include cleaning info for CLEANING questions
    if question_type == 'CLEANING':
        cleaning = analysis.get('cleaning', {})
        context_parts.append('Cleaning Report: ' + str(cleaning))

    # Include METADATA for METADATA questions
    if question_type == 'METADATA':
        context_parts.append(f"Total rows: {analysis.get('rowCount', 'N/A')}")
        context_parts.append(f"Total columns: {analysis.get('colCount', 'N/A')}")
        context_parts.append(f"Columns: {', '.join(analysis.get('columns', []))}")
        parse_info = analysis.get('parseInfo', {})
        if parse_info:
            context_parts.append(f"File info: {str(parse_info)}")

    # For GENERAL_ANALYTICS, include a summary
    if question_type == 'GENERAL_ANALYTICS':
        context_parts.append(f"Dataset: {analysis.get('rowCount', '?')} rows x {analysis.get('colCount', '?')} columns")
        for kpi in kpis[:8]:
            context_parts.append(f"{kpi['label']}: {kpi['value']}")

    # Join and enforce context size limit
    full_context = '\n\n'.join(context_parts)
    max_context = 8000
    if len(full_context) > max_context:
        full_context = full_context[:max_context] + '\n... [context truncated]'

    return full_context


def build_document_context(question, question_type, analysis, retrieved_chunks, cfg):
    """
    Build LLM context for document questions.
    Uses retrieved chunks from the document.
    """
    context_parts = []

    # Document metadata
    doc = analysis.get('document', {})
    meta = doc.get('metadata', {})
    if meta:
        meta_text = 'Document Metadata:\n'
        for k, v in meta.items():
            if v:
                meta_text += f'  - {k}: {v}\n'
        context_parts.append(meta_text)

    # Retrieved chunks
    if retrieved_chunks:
        context_parts.append('Relevant Document Sections:')
        for chunk in retrieved_chunks:
            source_info = ''
            if chunk.get('page'):
                source_info = f" (Page {chunk['page']})"
            elif chunk.get('section'):
                source_info = f" (Section: {chunk['section']})"
            context_parts.append(f"  ---{source_info}---\n{chunk['text']}")
    else:
        # Fallback: use full text
        full_text = doc.get('fullText', '')
        if full_text:
            context_parts.append(f'Document Content (excerpt):\n{full_text[:6000]}')

    # Tables from document
    tables = doc.get('tables', [])
    if tables:
        context_parts.append('\nTables found in document:')
        for t in tables[:5]:
            context_parts.append(f"  Table {t.get('tableIndex', '?')}: {t.get('headers', [])} ({t.get('rowCount', 0)} rows)")

    full_context = '\n\n'.join(context_parts)
    max_context = 8000
    if len(full_context) > max_context:
        full_context = full_context[:max_context] + '\n... [context truncated]'

    return full_context


def build_mixed_context(question, question_type, analysis, retrieved_chunks, cfg):
    """
    Build context for mixed (tabular + document) questions.
    Combines both sources.
    """
    tabular_ctx = build_tabular_context(question, question_type, analysis, [], cfg)
    document_ctx = build_document_context(question, question_type, analysis, retrieved_chunks, cfg)

    return f"=== TABULAR DATA CONTEXT ===\n{tabular_ctx}\n\n=== DOCUMENT CONTEXT ===\n{document_ctx}"


def _format_stats(stats):
    """Format statistics dict into readable text."""
    parts = []
    if 'count' in stats:
        parts.append(f"count={stats['count']}")
    if 'mean' in stats:
        parts.append(f"mean={stats['mean']}")
    if 'median' in stats:
        parts.append(f"median={stats['median']}")
    if 'std' in stats:
        parts.append(f"std={stats['std']}")
    if 'min' in stats:
        parts.append(f"min={stats['min']}")
    if 'max' in stats:
        parts.append(f"max={stats['max']}")
    if 'q1' in stats:
        parts.append(f"Q1={stats['q1']}")
    if 'q3' in stats:
        parts.append(f"Q3={stats['q3']}")
    if 'skewness' in stats:
        parts.append(f"skew={stats['skewness']}")
    return ', '.join(parts)
