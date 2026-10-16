def parse_rtf(file_path, cfg):
    """
    Parse RTF files safely - extract text content only.
    Never execute embedded content.
    Returns a normalized document dict.
    """
    with open(file_path, 'rb') as f:
        raw = f.read()

    # Check max size
    if len(raw) > cfg['max_extracted_text_chars'] * 10:
        raise ValueError('RTF file is too large to process safely.')

    # Decode RTF to plain text by stripping control words
    text = _strip_rtf_controls(raw.decode('latin-1', errors='replace'))
    text = text.strip()

    if not text:
        raise ValueError('No extractable text found in RTF file.')

    # Split into paragraphs
    paragraphs = [p.strip() for p in text.split('\n') if p.strip()]

    result = {
        'metadata': {},
        'pages': [],
        'sections': [{
            'heading': 'Document Content',
            'content': text[:cfg['max_extracted_text_chars']],
        }],
        'tables': [],
        'totalPages': 1,
        'documentType': 'RTF',
        'fullText': text[:cfg['max_extracted_text_chars']],
    }

    return result


def _strip_rtf_controls(text):
    """
    Strip RTF control sequences, leaving only visible text.
    This is a safe, non-executing parser.
    """
    import re

    # Remove control words (e.g., \b, \i, \par, \rtf1, etc.)
    text = re.sub(r'\\[a-zA-Z]+\d*-?\s?', ' ', text)
    # Remove control symbols (e.g., \{, \}, \\)
    text = re.sub(r'\\[{}\\]', '', text)
    # Remove leftover braces
    text = re.sub(r'[{}]', '', text)
    # Clean up whitespace
    text = re.sub(r'\s+', ' ', text)
    return text.strip()