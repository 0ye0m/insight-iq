import re
import math
from collections import Counter


def retrieve_chunks(question, chunks, top_k=5):
    """
    Lightweight keyword/BM25-style retrieval.
    Returns top-K chunks ranked by relevance.
    """
    if not chunks or not question:
        return []

    # Tokenize question
    query_tokens = _tokenize(question)
    if not query_tokens:
        return chunks[:top_k]

    # Build document frequency (DF)
    df = Counter()
    for chunk in chunks:
        chunk_tokens = set(_tokenize(chunk['text']))
        for token in chunk_tokens:
            df[token] += 1

    N = len(chunks)

    # Score each chunk
    scored = []
    for chunk in chunks:
        score = _bm25_score(query_tokens, chunk['text'], df, N, k1=1.5, b=0.75)
        scored.append((chunk, score))

    # Sort by score descending
    scored.sort(key=lambda x: x[1], reverse=True)

    # Return top-K with scores
    results = []
    for chunk, score in scored[:top_k]:
        if score > 0:
            results.append({
                **chunk,
                'score': round(score, 4),
            })

    return results


def _tokenize(text):
    """Simple tokenization: lowercase, split on non-alphanumeric."""
    text = text.lower()
    tokens = re.findall(r'[a-z0-9]+', text)
    # Remove very short tokens
    return [t for t in tokens if len(t) > 1]


def _bm25_score(query_tokens, document_text, df, N, k1=1.5, b=0.75):
    """
    Compute BM25 score for a document against a query.
    """
    doc_tokens = _tokenize(document_text)
    if not doc_tokens:
        return 0.0

    doc_len = len(doc_tokens)
    avg_dl = doc_len  # Simplified: use document length as average

    doc_freq = Counter(doc_tokens)

    score = 0.0
    for token in query_tokens:
        if token not in doc_freq:
            continue

        tf = doc_freq[token]
        idf = math.log((N - df.get(token, 0) + 0.5) / (df.get(token, 0) + 0.5) + 1)

        tf_norm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc_len / avg_dl))
        score += idf * tf_norm

    return score
