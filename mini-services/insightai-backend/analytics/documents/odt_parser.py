import os


def parse_odt(file_path, cfg):
    """
    Parse ODT files using odfpy.
    Returns a normalized document dict.
    """
    try:
        from odf.opendocument import load
        from odf.text import P, H, List
        from odf.table import Table, TableRow, TableCell
    except ImportError:
        raise ImportError('odfpy is required to parse ODT files. Install with: pip install odfpy')

    doc = load(file_path)
    result = {
        'metadata': {},
        'pages': [],
        'sections': [],
        'tables': [],
        'totalPages': 1,
        'documentType': 'ODT',
    }

    all_text = []
    current_heading = 'Document Content'
    section_text = []
    extracted_tables = []

    for element in doc.text.getElementsByType(P):
        text = ''
        for child in element.childNodes:
            if hasattr(child, 'data'):
                text += child.data
        if text.strip():
            all_text.append(text.strip())
            section_text.append(text.strip())

    for element in doc.text.getElementsByType(H):
        if section_text and current_heading:
            result['sections'].append({
                'heading': current_heading,
                'content': '\n'.join(section_text),
            })
            section_text = []
        text = ''
        for child in element.childNodes:
            if hasattr(child, 'data'):
                text += child.data
        current_heading = text.strip() or 'Untitled Section'
        all_text.append(text.strip())

    # Save last section
    if section_text:
        result['sections'].append({
            'heading': current_heading,
            'content': '\n'.join(section_text),
        })

    # Extract tables
    for table in doc.text.getElementsByType(Table):
        rows_data = []
        for tr in table.getElementsByType(TableRow):
            cells = []
            for tc in tr.getElementsByType(TableCell):
                cell_text = ''
                for child in tc.childNodes:
                    if hasattr(child, 'data'):
                        cell_text += child.data
                cells.append(cell_text.strip())
            if any(cells):
                rows_data.append(cells)

        if rows_data:
            extracted_tables.append({
                'headers': rows_data[0] if rows_data else [],
                'rows': rows_data[1:] if len(rows_data) > 1 else [],
                'rowCount': len(rows_data) - 1,
                'colCount': len(rows_data[0]) if rows_data else 0,
            })

    result['tables'] = extracted_tables
    result['fullText'] = '\n\n'.join(all_text)[:cfg['max_extracted_text_chars']]

    return result
