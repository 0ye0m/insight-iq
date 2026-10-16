import os


def parse_docx(file_path, cfg):
    """
    Parse DOCX files: extract paragraphs, headings, tables, metadata.
    Returns a normalized document dict.
    """
    from docx import Document

    doc = Document(file_path)
    result = {
        'metadata': {},
        'pages': [],
        'sections': [],
        'tables': [],
        'totalPages': 1,
        'documentType': 'DOCX',
    }

    # Core properties
    props = doc.core_properties
    result['metadata'] = {
        'title': props.title or '',
        'author': props.author or '',
        'subject': props.subject or '',
        'created': str(props.created) if props.created else '',
        'modified': str(props.modified) if props.modified else '',
    }

    total_text = []
    current_section = None
    section_text = []
    extracted_tables = []

    for element in doc.element.body:
        tag = element.tag.split('}')[-1] if '}' in element.tag else element.tag

        if tag == 'p':
            # It's a paragraph
            from docx.oxml.ns import qn
            p_pr = element.find(qn('w:pPr'))
            style_name = ''
            if p_pr is not None:
                p_style = p_pr.find(qn('w:pStyle'))
                if p_style is not None:
                    style_name = p_style.get(qn('w:val'), '')

            # Get text content
            texts = []
            for run in element.iter():
                if run.tag.endswith('}t'):
                    if run.text:
                        texts.append(run.text)
            para_text = ''.join(texts)

            if not para_text.strip():
                continue

            # Detect heading
            if 'Heading' in style_name or 'heading' in style_name:
                # Save previous section
                if current_section and section_text:
                    result['sections'].append({
                        'heading': current_section,
                        'content': '\n'.join(section_text),
                    })
                current_section = para_text.strip()
                section_text = []
            else:
                section_text.append(para_text)
                total_text.append(para_text)

        elif tag == 'tbl':
            # It's a table
            try:
                table_data = _extract_docx_table(element)
                if table_data and table_data['rows']:
                    extracted_tables.append(table_data)
            except Exception:
                pass

    # Save last section
    if current_section and section_text:
        result['sections'].append({
            'heading': current_section,
            'content': '\n'.join(section_text),
        })
    elif not current_section and section_text:
        result['sections'].append({
            'heading': 'Document Content',
            'content': '\n'.join(section_text),
        })

    result['tables'] = extracted_tables
    result['fullText'] = '\n\n'.join(total_text)[:cfg['max_extracted_text_chars']]

    return result


def _extract_docx_table(tbl_element):
    """Extract table data from a DOCX table element."""
    from docx.oxml.ns import qn

    rows = []
    for tr in tbl_element.findall(qn('w:tr')):
        cells = []
        for tc in tr.findall(qn('w:tc')):
            cell_texts = []
            for p in tc.findall(qn('w:p')):
                texts = []
                for run in p.iter():
                    if run.tag.endswith('}t') and run.text:
                        texts.append(run.text)
                cell_texts.append(''.join(texts))
            cells.append(' '.join(cell_texts).strip())
        if any(cells):
            rows.append(cells)

    if not rows:
        return None

    headers = rows[0] if rows else []
    data_rows = rows[1:] if len(rows) > 1 else []

    return {
        'headers': headers,
        'rows': data_rows,
        'rowCount': len(data_rows),
        'colCount': len(headers),
    }
