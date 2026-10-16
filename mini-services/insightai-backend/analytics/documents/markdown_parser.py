def parse_markdown(file_path, cfg):
    """
    Parse Markdown files: extract headings, paragraphs, lists, tables, code blocks.
    Preserve heading hierarchy.
    Returns a normalized document dict.
    """
    import re

    with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
        raw = f.read()

    lines = raw.split('\n')
    sections = []
    tables = []
    all_text = []
    current_heading = 'Document Content'
    section_lines = []
    in_code_block = False
    in_table = False
    table_rows = []

    for line in lines:
        # Toggle code blocks
        if line.strip().startswith('```'):
            if in_code_block:
                in_code_block = False
                section_lines.append('')
            else:
                in_code_block = True
            continue

        if in_code_block:
            section_lines.append(f'  {line}')
            continue

        # Skip empty lines in tables
        stripped = line.strip()
        if not stripped:
            if in_table and table_rows:
                tables.append(_parse_markdown_table(table_rows))
                table_rows = []
                in_table = False
            continue

        # Detect headings
        heading_match = re.match(r'^(#{1,6})\s+(.+)$', line)
        if heading_match:
            # Save previous section
            if section_lines or current_heading != 'Document Content':
                sections.append({
                    'heading': current_heading,
                    'content': '\n'.join(section_lines).strip(),
                })
                section_lines = []
            level = len(heading_match.group(1))
            current_heading = heading_match.group(2).strip()
            all_text.append(f'[H{level}] {current_heading}')
            continue

        # Detect table
        if '|' in stripped and stripped.startswith('|'):
            in_table = True
            # Skip separator rows (|---|---|)
            if re.match(r'^[\|\s\-:]+$', stripped):
                continue
            table_rows.append(stripped)
            continue

        if in_table and table_rows:
            tables.append(_parse_markdown_table(table_rows))
            table_rows = []
            in_table = False

        # Links: extract text, not URL
        line_text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', line)
        section_lines.append(line_text.strip())
        all_text.append(line_text.strip())

    # Save last section
    if section_lines:
        sections.append({
            'heading': current_heading,
            'content': '\n'.join(section_lines).strip(),
        })

    # Save remaining table
    if table_rows:
        tables.append(_parse_markdown_table(table_rows))

    full_text = '\n'.join(all_text)

    result = {
        'metadata': {},
        'pages': [],
        'sections': sections,
        'tables': tables,
        'totalPages': 1,
        'documentType': 'MARKDOWN',
        'fullText': full_text[:cfg['max_extracted_text_chars']],
    }

    return result


def _parse_markdown_table(rows):
    """Parse markdown table rows into structured data."""
    if not rows:
        return None
    parsed = []
    for row in rows:
        cells = [c.strip() for c in row.split('|')]
        cells = [c for c in cells if c]  # Remove empty strings from edges
        if cells:
            parsed.append(cells)

    if not parsed:
        return None

    return {
        'headers': parsed[0],
        'rows': parsed[1:] if len(parsed) > 1 else [],
        'rowCount': len(parsed) - 1,
        'colCount': len(parsed[0]),
    }