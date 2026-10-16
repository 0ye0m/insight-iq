import os


def parse_pdf(file_path, cfg):
    """
    Parse PDF files: extract text, tables, and metadata.
    Returns a normalized document dict.
    """
    import pypdf
    try:
        import pdfplumber
        HAS_PDFPLUMBER = True
    except ImportError:
        HAS_PDFPLUMBER = False

    result = {
        'metadata': {},
        'pages': [],
        'sections': [],
        'tables': [],
        'totalPages': 0,
        'documentType': None,
        'ocrRequired': False,
    }

    # Read with pypdf for metadata and basic text
    reader = pypdf.PdfReader(file_path)
    result['totalPages'] = len(reader.pages)

    if len(reader.pages) > cfg['max_pages']:
        raise ValueError(f'PDF has {len(reader.pages)} pages, exceeding limit of {cfg["max_pages"]}.')

    # Extract metadata
    meta = reader.metadata
    if meta:
        result['metadata'] = {
            'title': meta.title or '',
            'author': meta.author or '',
            'subject': meta.subject or '',
            'creator': meta.creator or '',
            'producer': meta.producer or '',
        }

    total_text_len = 0
    all_text = []

    # Extract text page by page
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ''
        all_text.append(text)
        total_text_len += len(text)

    # Classify PDF type
    if total_text_len < 100 and result['totalPages'] > 0:
        # Likely scanned
        result['documentType'] = 'SCANNED_PDF'
        result['ocrRequired'] = True
        if not cfg['ocr_enabled']:
            return {
                **result,
                'warning': 'The document appears to be scanned and requires OCR. OCR is not configured.',
            }
        # If OCR is enabled, attempt it
        if cfg['ocr_enabled']:
            text = _attempt_ocr(file_path)
            if text:
                all_text = [text]
                total_text_len = len(text)
                result['documentType'] = 'TEXT_PDF'
                result['ocrRequired'] = False
                result['ocrUsed'] = True
    elif total_text_len > 0:
        # Check for tables
        table_count = 0
        extracted_tables = []

        if HAS_PDFPLUMBER:
            try:
                with pdfplumber.open(file_path) as pdf:
                    for pi, p in enumerate(pdf.pages):
                        tables = p.extract_tables()
                        for ti, table in enumerate(tables):
                            if table and len(table) > 0 and len(table[0]) > 0:
                                headers = table[0]
                                rows = table[1:] if len(table) > 1 else []
                                extracted_tables.append({
                                    'page': pi + 1,
                                    'tableIndex': ti + 1,
                                    'headers': headers,
                                    'rows': rows,
                                    'rowCount': len(rows),
                                    'colCount': len(headers),
                                })
                                table_count += 1
            except Exception:
                pass

        result['tables'] = extracted_tables

        if table_count > 0:
            result['documentType'] = 'MIXED_PDF'
        else:
            result['documentType'] = 'TEXT_PDF'
    else:
        result['documentType'] = 'TEXT_PDF'

    # Build pages array
    for i, text in enumerate(all_text):
        result['pages'].append({
            'pageNumber': i + 1,
            'text': text[:cfg['max_extracted_text_chars']],
            'charCount': len(text),
        })

    # Enforce text limit
    if total_text_len > cfg['max_extracted_text_chars']:
        result['warning'] = f'Extracted text truncated to {cfg["max_extracted_text_chars"]} characters.'

    return result


def _attempt_ocr(file_path):
    """Attempt OCR using Tesseract if available."""
    try:
        from PIL import Image
        import pytesseract

        images = []
        try:
            from pdf2image import convert_from_path
            images = convert_from_path(file_path, first_page=1, last_page=5)
        except ImportError:
            return ''

        texts = []
        for img in images:
            text = pytesseract.image_to_string(img)
            texts.append(text)

        return '\n\n'.join(texts)
    except Exception:
        return ''
