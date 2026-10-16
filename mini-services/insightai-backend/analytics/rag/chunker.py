import re
from collections import Counter
import math


def chunk_document(doc, cfg):
    """
    Split document content into meaningful chunks.
    Prefers: document -> heading -> section -> paragraph -> chunk.
    Each chunk has metadata: chunkId, text, page, section, sourceType.
    """
    chunk_size = cfg['chunk_size']
    chunk_overlap = cfg['chunk_overlap']
    max_chunks = cfg['max_chunks']

    chunks = []
    chunk_id = 0

    # Source type from document type
    doc_type = doc.get('documentType', 'unknown')
    source_type = doc_type.lower().replace('_pdf', '').replace('_docx', '').replace('_pptx', '')
    if not source_type or source_type == 'unknown':
        source_type = 'document'

    # Strategy 1: If we have sections (DOCX, Markdown, HTML, ODT)
    sections = doc.get('sections', [])
    if sections:
        for section in sections:
            heading = section.get('heading', '')
            content = section.get('content', '')
            if not content or not content.strip():
                continue

            # Split content into paragraphs
            paragraphs = re.split(r'\n\n+', content)
            current_chunk = ''

            for para in paragraphs:
                para = para.strip()
                if not para:
                    continue

                if len(current_chunk) + len(para) + 2 <= chunk_size:
                    current_chunk = f"{current_chunk}\n{para}".strip() if current_chunk else para
                else:
                    # Save current chunk
                    if current_chunk:
                        chunks.append({
                            'chunkId': f'chunk_{chunk_id:04d}',
                            'text': current_chunk.strip(),
                            'section': heading,
                            'page': None,
                            'sourceType': source_type,
                        })
                        chunk_id += 1

                    # Start new chunk with overlap from end of previous
                    if current_chunk and chunk_overlap > 0:
                        overlap_text = current_chunk[-chunk_overlap:]
                        current_chunk = f"{overlap_text}\n{para}"
                    else:
                        current_chunk = para

            # Save remaining
            if current_chunk:
                chunks.append({
                    'chunkId': f'chunk_{chunk_id:04d}',
                    'text': current_chunk.strip(),
                    'section': heading,
                    'page': None,
                    'sourceType': source_type,
                })
                chunk_id += 1

    # Strategy 2: If we have pages (PDF, PPTX)
    pages = doc.get('pages', [])
    if pages and not sections:
        for page in pages:
            page_num = page.get('pageNumber', None)
            text = ''

            # For PPTX, combine title and content
            if 'content' in page and isinstance(page['content'], list):
                text = '\n'.join(page.get('content', []))
                if page.get('title'):
                    text = f"{page['title']}\n{text}"
            else:
                text = page.get('text', '')

            if not text or not text.strip():
                continue

            # Split by paragraphs within page
            paragraphs = re.split(r'\n\n+', text)
            current_chunk = ''

            for para in paragraphs:
                para = para.strip()
                if not para:
                    continue

                if len(current_chunk) + len(para) + 2 <= chunk_size:
                    current_chunk = f"{current_chunk}\n{para}".strip() if current_chunk else para
                else:
                    if current_chunk:
                        chunks.append({
                            'chunkId': f'chunk_{chunk_id:04d}',
                            'text': current_chunk.strip(),
                            'section': f"Page {page_num}" if page_num else '',
                            'page': page_num,
                            'sourceType': source_type,
                        })
                        chunk_id += 1

                    if current_chunk and chunk_overlap > 0:
                        overlap_text = current_chunk[-chunk_overlap:]
                        current_chunk = f"{overlap_text}\n{para}"
                    else:
                        current_chunk = para

            if current_chunk:
                chunks.append({
                    'chunkId': f'chunk_{chunk_id:04d}',
                    'text': current_chunk.strip(),
                    'section': f"Page {page_num}" if page_num else '',
                    'page': page_num,
                    'sourceType': source_type,
                })
                chunk_id += 1

    # Strategy 3: Fallback to fullText
    if not chunks:
        full_text = doc.get('fullText', '')
        if full_text:
            paragraphs = re.split(r'\n\n+', full_text)
            current_chunk = ''

            for para in paragraphs:
                para = para.strip()
                if not para:
                    continue

                if len(current_chunk) + len(para) + 2 <= chunk_size:
                    current_chunk = f"{current_chunk}\n{para}".strip() if current_chunk else para
                else:
                    if current_chunk:
                        chunks.append({
                            'chunkId': f'chunk_{chunk_id:04d}',
                            'text': current_chunk.strip(),
                            'section': '',
                            'page': None,
                            'sourceType': source_type,
                        })
                        chunk_id += 1

                    if current_chunk and chunk_overlap > 0:
                        overlap_text = current_chunk[-chunk_overlap:]
                        current_chunk = f"{overlap_text}\n{para}"
                    else:
                        current_chunk = para

            if current_chunk:
                chunks.append({
                    'chunkId': f'chunk_{chunk_id:04d}',
                    'text': current_chunk.strip(),
                    'section': '',
                    'page': None,
                    'sourceType': source_type,
                })
                chunk_id += 1

    # Enforce max chunks
    if len(chunks) > max_chunks:
        chunks = chunks[:max_chunks]

    return chunks
