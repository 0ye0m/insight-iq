def parse_html(file_path, cfg):
    """
    Parse HTML files: extract text content, headings, tables, lists.
    Removes scripts, styles, and executable content.
    Returns a normalized document dict.
    """
    from bs4 import BeautifulSoup

    with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
        raw_html = f.read()

    soup = BeautifulSoup(raw_html, 'html.parser')

    # Remove scripts, styles, and dangerous elements
    for tag in soup(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'applet']):
        tag.decompose()

    # Extract title
    title = ''
    title_tag = soup.find('title')
    if title_tag:
        title = title_tag.get_text(strip=True)

    # Extract headings and build sections
    all_text = []
    sections = []
    current_heading = title or 'Document Content'
    section_content = []

    # Iterate through all text-containing elements in order
    for element in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'td', 'th', 'tr']):
        tag = element.name
        text = element.get_text(strip=True)
        if not text:
            continue

        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            # Save previous section
            if section_content:
                sections.append({
                    'heading': current_heading,
                    'content': '\n'.join(section_content),
                })
                section_content = []
            current_heading = text
            all_text.append(f'[{tag.upper()}] {text}')
        else:
            section_content.append(text)
            all_text.append(text)

    # Save last section
    if section_content:
        sections.append({
            'heading': current_heading,
            'content': '\n'.join(section_content),
        })

    if not sections:
        sections.append({
            'heading': title or 'Document Content',
            'content': soup.get_text(separator='\n', strip=True)[:cfg['max_extracted_text_chars']],
        })

    # Extract tables
    extracted_tables = []
    for table_idx, table in enumerate(soup.find_all('table')):
        headers = []
        rows = []
        for ri, tr in enumerate(table.find_all('tr')):
            cells = [td.get_text(strip=True) for td in tr.find_all(['td', 'th'])]
            if not cells:
                continue
            if ri == 0:
                headers = cells
            else:
                rows.append(cells)

        if headers or rows:
            extracted_tables.append({
                'tableIndex': table_idx + 1,
                'headers': headers,
                'rows': rows,
                'rowCount': len(rows),
                'colCount': len(headers) if headers else (len(rows[0]) if rows else 0),
            })

    full_text = '\n'.join(all_text)

    result = {
        'metadata': {'title': title},
        'pages': [],
        'sections': sections,
        'tables': extracted_tables,
        'totalPages': 1,
        'documentType': 'HTML',
        'fullText': full_text[:cfg['max_extracted_text_chars']],
    }

    return result